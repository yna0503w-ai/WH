import * as THREE from "three";

export type ClothRuntimeConfig = {
  damping: number;
  gravity: number;
  stiffness: number;
  windStrength: number;
  wrinkleIntensity: number;
};

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

  update(delta: number, elapsed: number, config: ClothRuntimeConfig) {
    const safeDelta = Math.min(delta, 1 / 30);
    const timeStep = safeDelta * safeDelta;
    const intro = THREE.MathUtils.smoothstep(Math.min(elapsed / 3.2, 1), 0, 1);
    const wind = config.windStrength * intro;
    const pulse = this.pulseEnergy;

    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.acceleration.set(0, -config.gravity, 0);
      particle.force.set(0, -config.gravity, 0);

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
