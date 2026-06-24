import * as THREE from "three";

export type ClothRuntimeConfig = {
  damping: number;
  gravity: number;
  stiffness: number;
  windStrength: number;
  wrinkleIntensity: number;
};

export type FanEmitterConfig = {
  enabled: boolean;
  strength: number;
  radius: number;
  coneAngle: number;
  turbulence: number;
  pulse: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  rotX: number;
};

export const DEFAULT_FAN_CONFIG: FanEmitterConfig = {
  enabled: true,
  strength: 12,
  radius: 6,
  coneAngle: 35,
  turbulence: 0.6,
  pulse: 0.2,
  posX: 2.82,
  posY: -1.22,
  posZ: 0.46,
  rotY: 1.25,
  rotX: 0.35,
};

export type FanEmitter = {
  enabled: boolean;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  strength: number;
  radius: number;
  coneAngle: number; // radians
  turbulence: number;
  pulse: number;
};

const _euler = new THREE.Euler(0, 0, 0, "XYZ");
const _dir = new THREE.Vector3(0, 0, -1);

export function buildFanEmitter(config: FanEmitterConfig): FanEmitter {
  _dir.set(0, 0, -1);
  _euler.set(config.rotX, config.rotY, 0, "XYZ");
  _dir.applyEuler(_euler).normalize();

  // Calculate the world offset of the fan blades (0, 0.94 * 0.82, 0)
  // where 0.82 is the visual scale of the fan group in ClothScene.tsx
  const localOffset = new THREE.Vector3(0, 0.94 * 0.82, 0);
  localOffset.applyEuler(_euler);

  const worldPos = new THREE.Vector3(config.posX, config.posY, config.posZ).add(localOffset);

  return {
    enabled: config.enabled,
    position: worldPos,
    direction: _dir.clone(),
    strength: config.strength,
    radius: config.radius,
    coneAngle: (config.coneAngle * Math.PI) / 180,
    turbulence: config.turbulence,
    pulse: config.pulse,
  };
}

export type ClothOptions = {
  width: number;
  height: number;
  segmentsX: number;
  segmentsY: number;
};

type Particle = {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  original: THREE.Vector3;
  acceleration: THREE.Vector3;
  force: THREE.Vector3;
  invMass: number;
  mass: number;
  pinned: boolean;
  softPin: number;
};

type Constraint = {
  a: number;
  b: number;
  rest: number;
  strength: number;
};

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();

// Simple 3D noise approximation for turbulence
function simpleNoise3D(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

export class ClothSimulation {
  readonly options: ClothOptions;
  readonly particles: Particle[] = [];
  readonly constraints: Constraint[] = [];
  readonly topLeftIndex = 0;
  readonly topRightIndex: number;
  readonly bottomRightIndex: number;
  private grabIndex: number | null = null;
  private grabTarget = new THREE.Vector3();
  private grabPreviousTarget = new THREE.Vector3();
  private hoverPoint: THREE.Vector3 | null = null;
  private pulseEnergy = 0;

  constructor(options: ClothOptions) {
    this.options = options;
    this.topRightIndex = options.segmentsX;
    this.bottomRightIndex = this.index(options.segmentsX, options.segmentsY);
    this.createParticles();
    this.createConstraints();
  }

  reset() {
    for (const particle of this.particles) {
      particle.position.copy(particle.original);
      particle.previous.copy(particle.original);
      particle.acceleration.set(0, 0, 0);
    }
    this.grabIndex = null;
    this.pulseEnergy = 0.12;
  }

  pulse(amount = 0.08) {
    this.pulseEnergy = Math.max(this.pulseEnergy, amount);
  }

  index(x: number, y: number) {
    return y * (this.options.segmentsX + 1) + x;
  }

  getParticlePosition(index: number) {
    return this.particles[index].position;
  }

  findNearestParticle(point: THREE.Vector3, radius = Number.POSITIVE_INFINITY) {
    let closest = -1;
    let closestDistance = radius * radius;

    for (let i = 0; i < this.particles.length; i += 1) {
      if (this.particles[i].pinned) {
        continue;
      }

      const distance = this.particles[i].position.distanceToSquared(point);
      if (distance < closestDistance) {
        closest = i;
        closestDistance = distance;
      }
    }

    return closest === -1 ? null : closest;
  }

  grabParticle(index: number, target: THREE.Vector3) {
    const particle = this.particles[index];
    if (!particle || particle.pinned) {
      return false;
    }

    this.grabIndex = index;
    this.grabTarget.copy(target);
    this.grabPreviousTarget.copy(target);
    particle.previous.copy(particle.position);
    return true;
  }

  grabNearest(point: THREE.Vector3, radius = 0.7) {
    const nearest = this.findNearestParticle(point, radius);
    if (nearest === null) {
      return null;
    }

    this.grabParticle(nearest, point);
    return nearest;
  }

  grabIndexDirect(index: number, target: THREE.Vector3) {
    return this.grabParticle(index, target);
  }

  dragGrabbedParticle(point: THREE.Vector3) {
    if (this.grabIndex !== null) {
      this.grabTarget.copy(point);
    }
  }

  setGrabTarget(point: THREE.Vector3) {
    this.dragGrabbedParticle(point);
  }

  releaseParticle() {
    if (this.grabIndex !== null) {
      const particle = this.particles[this.grabIndex];
      scratchA.subVectors(particle.position, particle.previous).multiplyScalar(0.32);
      particle.previous.copy(particle.position).sub(scratchA);
      this.applyImpulse(particle.position, 0.82, 0.17);
    }

    this.grabIndex = null;
  }

  releaseGrab() {
    this.releaseParticle();
  }

  isGrabbed() {
    return this.grabIndex !== null;
  }

  setHoverPoint(point: THREE.Vector3 | null) {
    this.hoverPoint = point ? point.clone() : null;
  }

  applyPointerForce(center: THREE.Vector3, radius: number, strength: number) {
    for (const particle of this.particles) {
      if (particle.pinned) {
        continue;
      }

      const distance = particle.position.distanceTo(center);
      if (distance >= radius) {
        continue;
      }

      const influence = 1 - THREE.MathUtils.smoothstep(distance, 0, radius);
      particle.force.z += influence * strength;
      particle.force.x += (particle.position.x - center.x) * influence * strength * 0.22;
      particle.force.y += (particle.position.y - center.y) * influence * strength * 0.12;
    }
  }

  applyImpulse(center: THREE.Vector3, radius: number, strength: number) {
    for (const particle of this.particles) {
      if (particle.pinned) {
        continue;
      }

      const distance = particle.position.distanceTo(center);
      if (distance >= radius) {
        continue;
      }

      const influence = 1 - THREE.MathUtils.smoothstep(distance, 0, radius);
      scratchA.subVectors(particle.position, center);
      if (scratchA.lengthSq() < 0.0001) {
        scratchA.set(0.08, -0.05, 0.18);
      }
      scratchA.normalize();
      scratchA.z += 0.42;
      scratchA.normalize();

      const impulse = strength * influence;
      particle.position.addScaledVector(scratchA, impulse * 0.18);
      particle.previous.addScaledVector(scratchA, -impulse);
    }
  }

  /**
   * Apply wind from a FanEmitter to all cloth particles.
   * This is called every frame before constraint solving.
   */
  applyWindEmitter(emitter: FanEmitter, deltaTime: number, elapsed: number) {
    if (!emitter.enabled) {
      return;
    }

    const cosConeAngle = Math.cos(emitter.coneAngle);
    const pulseFactor = 1 + Math.sin(elapsed * 3.2) * emitter.pulse;

    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      if (particle.pinned) {
        continue;
      }

      // Vector from fan to particle
      scratchA.subVectors(particle.position, emitter.position);
      const distance = scratchA.length();

      // Skip if outside radius
      if (distance >= emitter.radius || distance < 0.001) {
        continue;
      }

      scratchC.copy(scratchA).normalize();

      // Check if particle is in front of the fan (dot product with fan direction)
      const facing = emitter.direction.dot(scratchC);
      if (facing < cosConeAngle) {
        // Outside the cone angle, no wind
        continue;
      }

      // Distance falloff: stronger when closer
      const distanceFalloff = 1 - THREE.MathUtils.smoothstep(distance, 0, emitter.radius);

      // Angle falloff: stronger when more aligned with fan center
      const angleFalloff = THREE.MathUtils.smoothstep(cosConeAngle, 1, facing);

      // Base wind force along fan direction
      const baseStrength = emitter.strength * distanceFalloff * angleFalloff * pulseFactor;

      scratchB.copy(emitter.direction).multiplyScalar(baseStrength);

      // Turbulence: add noise-based perturbation
      if (emitter.turbulence > 0) {
        const nx = simpleNoise3D(particle.position.x * 2.1, particle.position.y * 1.7, elapsed * 1.3);
        const ny = simpleNoise3D(particle.position.x * 1.8, particle.position.y * 2.3, elapsed * 1.7 + 50);
        const nz = simpleNoise3D(particle.position.x * 2.5, particle.position.y * 1.4, elapsed * 1.1 + 100);
        scratchB.x += nx * emitter.turbulence * baseStrength * 0.45;
        scratchB.y += ny * emitter.turbulence * baseStrength * 0.35;
        scratchB.z += nz * emitter.turbulence * baseStrength * 0.25;
      }

      // Apply force to particle
      particle.force.add(scratchB);
    }
  }

  /**
   * Apply a force to a specific particle by index
   */
  applyForceToParticle(index: number, force: THREE.Vector3) {
    if (index >= 0 && index < this.particles.length) {
      this.particles[index].force.add(force);
    }
  }

  /**
   * Compute the approximate normal at a particle position using neighboring particles.
   * Useful for pressure calculations.
   */
  computeParticleNormal(index: number): THREE.Vector3 {
    const { segmentsX, segmentsY } = this.options;
    const x = index % (segmentsX + 1);
    const y = Math.floor(index / (segmentsX + 1));

    const p = this.particles[index].position;
    const normal = new THREE.Vector3(0, 0, 1);

    const left = x > 0 ? this.particles[index - 1].position : null;
    const right = x < segmentsX ? this.particles[index + 1].position : null;
    const up = y > 0 ? this.particles[index - (segmentsX + 1)].position : null;
    const down = y < segmentsY ? this.particles[index + (segmentsX + 1)].position : null;

    if (right && up) {
      scratchA.subVectors(right, p);
      scratchB.subVectors(up, p);
      normal.crossVectors(scratchA, scratchB).normalize();
    } else if (left && down) {
      scratchA.subVectors(left, p);
      scratchB.subVectors(down, p);
      normal.crossVectors(scratchA, scratchB).normalize();
    } else if (right) {
      scratchA.subVectors(right, p);
      scratchB.set(0, 1, 0);
      normal.crossVectors(scratchA, scratchB).normalize();
    } else if (down) {
      scratchA.subVectors(down, p);
      scratchB.set(1, 0, 0);
      normal.crossVectors(scratchB, scratchA).normalize();
    }

    return normal;
  }

  update(delta: number, elapsed: number, config: ClothRuntimeConfig, windEmitter?: FanEmitter) {
    const safeDelta = Math.min(delta, 1 / 30);
    const timeStep = safeDelta * safeDelta;
    const intro = THREE.MathUtils.smoothstep(Math.min(elapsed / 3.2, 1), 0, 1);
    const wind = config.windStrength * intro;
    const pulse = this.pulseEnergy;

    // Precompute wind emitter values if provided
    const cosConeAngle = windEmitter?.enabled ? Math.cos(windEmitter.coneAngle) : null;
    const pulseFactor = windEmitter?.enabled ? 1 + Math.sin(elapsed * 3.2) * windEmitter.pulse : 1;

    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.acceleration.set(0, -config.gravity, 0);
      particle.force.set(0, -config.gravity, 0);

      // === Fan wind force — applied inline so it survives the force reset ===
      if (windEmitter?.enabled && !particle.pinned && cosConeAngle !== null) {
        scratchA.subVectors(particle.position, windEmitter.position);
        const distance = scratchA.length();

        if (distance < windEmitter.radius && distance >= 0.001) {
          scratchC.copy(scratchA).normalize();
          const facing = windEmitter.direction.dot(scratchC);

          if (facing >= cosConeAngle) {
            const distanceFalloff = 1 - THREE.MathUtils.smoothstep(distance, 0, windEmitter.radius);
            // Gentler angle falloff so wind doesn't drop to 0 at the cone boundaries
            const angleFalloff = 0.45 + 0.55 * THREE.MathUtils.smoothstep(cosConeAngle, 1, facing);
            // Scaled up by 32.0 (up from 3.5) for robust physical impact
            const baseStrength = windEmitter.strength * distanceFalloff * angleFalloff * pulseFactor * 32.0;

            // Get particle surface normal
            const normal = this.computeParticleNormal(i);

            // Aerodynamic Lift and Drag model:
            const dotNormal = normal.dot(windEmitter.direction);

            // Drag component along wind direction (stronger push forward)
            const dragCoeff = 0.85;
            scratchB.copy(windEmitter.direction).multiplyScalar(baseStrength * dragCoeff);

            // Lift/Pressure component along cloth normal (pushed away from wind source)
            const liftCoeff = 1.25;
            const normalForceDir = normal.clone().multiplyScalar(Math.sign(dotNormal) || 1);
            scratchB.addScaledVector(normalForceDir, baseStrength * liftCoeff * Math.abs(dotNormal));

            // Dynamic wave-based flutter and turbulence
            if (windEmitter.turbulence > 0) {
              // Propagating wave phase based on distance from fan and time
              const wavePhase = elapsed * 15.5 - distance * 4.2;
              const noiseX = simpleNoise3D(particle.position.x * 2.1, particle.position.y * 1.7, elapsed * 1.3);
              const noiseY = simpleNoise3D(particle.position.x * 1.8, particle.position.y * 2.3, elapsed * 1.7 + 50);
              
              // Wave-based flutter ripple along normal
              const flutterWave = Math.sin(wavePhase) * windEmitter.turbulence * baseStrength * 0.75;

              // Turbulent noise perturbation in XY
              scratchB.x += noiseX * windEmitter.turbulence * baseStrength * 0.45;
              scratchB.y += noiseY * windEmitter.turbulence * baseStrength * 0.35;

              // Apply the propagating ripple along normal
              scratchB.addScaledVector(normalForceDir, flutterWave);
            }

            particle.force.add(scratchB);
          }
        }
      }

      // Ambient wind (light global breeze, much reduced when fan is active)
      const xWave = particle.original.x * 1.9;
      const yWave = particle.original.y * 2.7;
      const clothWave = Math.sin(elapsed * 1.32 + xWave) + Math.cos(elapsed * 0.87 + yWave);
      particle.force.z += (clothWave * 0.5 + Math.sin(elapsed * 2 + xWave * 1.4)) * wind;
      particle.force.x += Math.sin(elapsed * 0.8 + yWave) * wind * 0.035;

      if (pulse > 0) {
        particle.force.z += Math.sin(xWave * 2.1 + yWave) * pulse * 11;
      }

      if (this.hoverPoint) {
        const distance = particle.position.distanceTo(this.hoverPoint);
        if (distance < 0.62) {
          const influence = 1 - THREE.MathUtils.smoothstep(distance, 0, 0.62);
          particle.force.z += influence * 2.2;
          particle.force.x += (particle.position.x - this.hoverPoint.x) * influence * 0.85;
          particle.force.y += (particle.position.y - this.hoverPoint.y) * influence * 0.45;
        }
      }

      if (particle.pinned) {
        particle.position.copy(particle.original);
        particle.previous.copy(particle.original);
        continue;
      }

      particle.acceleration.copy(particle.force).multiplyScalar(particle.invMass);
      scratchA.copy(particle.position);
      scratchB.subVectors(particle.position, particle.previous).multiplyScalar(config.damping);
      particle.position.add(scratchB).addScaledVector(particle.acceleration, timeStep);
      particle.previous.copy(scratchA);
      particle.acceleration.set(0, 0, 0);
      particle.force.set(0, 0, 0);
    }

    if (this.grabIndex !== null) {
      this.applyGrab();
    }

    const iterations = 5;
    for (let pass = 0; pass < iterations; pass += 1) {
      for (const constraint of this.constraints) {
        this.satisfyConstraint(constraint, config.stiffness);
      }

      this.applyPins();
      this.applyFloor();
    }

    this.pulseEnergy *= 0.88;
  }

  writePositions(target: Float32Array) {
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i].position;
      const offset = i * 3;
      target[offset] = particle.x;
      target[offset + 1] = particle.y;
      target[offset + 2] = particle.z;
    }
  }

  private createParticles() {
    const { width, height, segmentsX, segmentsY } = this.options;

    for (let y = 0; y <= segmentsY; y += 1) {
      for (let x = 0; x <= segmentsX; x += 1) {
        const u = x / segmentsX;
        const v = y / segmentsY;
        const position = new THREE.Vector3(
          (u - 0.5) * width,
          (0.5 - v) * height,
          Math.sin(u * Math.PI * 2) * 0.015,
        );
        const isCornerPin = (x === 0 && y === 0) || (x === segmentsX && y === 0);
        const isSoftTop = y === 0;
        const isNearTop = y < 3;

        this.particles.push({
          position: position.clone(),
          previous: position.clone(),
          original: position,
          acceleration: new THREE.Vector3(),
          force: new THREE.Vector3(),
          invMass: isCornerPin ? 0 : 1,
          mass: isCornerPin ? Number.POSITIVE_INFINITY : 1,
          pinned: isCornerPin,
          softPin: isCornerPin ? 1 : isSoftTop ? 0.12 : isNearTop ? 0.025 : 0,
        });
      }
    }
  }

  private createConstraints() {
    const { segmentsX, segmentsY } = this.options;

    for (let y = 0; y <= segmentsY; y += 1) {
      for (let x = 0; x <= segmentsX; x += 1) {
        if (x < segmentsX) {
          this.addConstraint(x, y, x + 1, y, 1);
        }
        if (y < segmentsY) {
          this.addConstraint(x, y, x, y + 1, 1);
        }
        if (x < segmentsX && y < segmentsY) {
          this.addConstraint(x, y, x + 1, y + 1, 0.74);
          this.addConstraint(x + 1, y, x, y + 1, 0.74);
        }
        if (x < segmentsX - 1) {
          this.addConstraint(x, y, x + 2, y, 0.28);
        }
        if (y < segmentsY - 1) {
          this.addConstraint(x, y, x, y + 2, 0.22);
        }
      }
    }
  }

  private addConstraint(ax: number, ay: number, bx: number, by: number, strength: number) {
    const a = this.index(ax, ay);
    const b = this.index(bx, by);
    this.constraints.push({
      a,
      b,
      rest: this.particles[a].original.distanceTo(this.particles[b].original),
      strength,
    });
  }

  private satisfyConstraint(constraint: Constraint, stiffness: number) {
    const a = this.particles[constraint.a];
    const b = this.particles[constraint.b];
    scratchA.subVectors(b.position, a.position);
    const distance = scratchA.length();

    if (distance === 0) {
      return;
    }

    const correction = (distance - constraint.rest) / distance;
    scratchA.multiplyScalar(correction * 0.5 * stiffness * constraint.strength);

    const totalInvMass = a.invMass + b.invMass;
    if (totalInvMass === 0) {
      return;
    }

    if (a.invMass > 0) {
      a.position.addScaledVector(scratchA, a.invMass / totalInvMass);
    }
    if (b.invMass > 0) {
      b.position.addScaledVector(scratchA, -b.invMass / totalInvMass);
    }
  }

  private applyGrab() {
    if (this.grabIndex === null) {
      return;
    }

    const grabbed = this.particles[this.grabIndex];
    const targetVelocity = scratchB.subVectors(this.grabTarget, this.grabPreviousTarget);
    grabbed.position.lerp(this.grabTarget, 0.42);
    grabbed.previous.addScaledVector(targetVelocity, -0.18);

    for (let i = 0; i < this.particles.length; i += 1) {
      if (i === this.grabIndex || this.particles[i].pinned) {
        continue;
      }

      const distance = this.particles[i].position.distanceTo(grabbed.position);
      const radius = 0.74;
      if (distance < radius) {
        const influence = 1 - THREE.MathUtils.smoothstep(distance, 0, radius);
        this.particles[i].position.lerp(this.grabTarget, influence * 0.075);
        this.particles[i].previous.addScaledVector(targetVelocity, -influence * 0.035);
      }
    }

    this.grabPreviousTarget.copy(this.grabTarget);
  }

  private applyPins() {
    for (const particle of this.particles) {
      if (particle.pinned) {
        particle.position.copy(particle.original);
        particle.previous.copy(particle.original);
      } else if (particle.softPin > 0) {
        particle.position.lerp(particle.original, particle.softPin);
      }
    }
  }

  private applyFloor() {
    const floor = -this.options.height * 0.58;
    for (const particle of this.particles) {
      if (particle.position.y < floor) {
        particle.position.y = floor;
        particle.previous.y = THREE.MathUtils.lerp(particle.previous.y, floor, 0.55);
      }
    }
  }
}
