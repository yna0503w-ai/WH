import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ClothRuntimeConfig, ClothSimulation, buildFanEmitter, FanEmitterConfig, FanEmitter } from "../physics/cloth";
import type { PageVariant } from "./PageTexture";
import { FanComponent } from "./FanComponent";

type ClothSceneProps = {
  interactionSignal: number;
  onVariantChange: (variant: PageVariant) => void;
  opacity: number;
  resetSignal: number;
  texture: THREE.Texture | null;
  textureVersion: number;
  variant: PageVariant;
  settings: ClothRuntimeConfig;
  fanConfig: FanEmitterConfig;
  onFanPositionChange: (x: number, y: number, z: number) => void;
  onFanRotationChange: (rotY: number, rotX: number) => void;
  fanDebugEnabled: boolean;
};

const CLOTH_WIDTH = 4.9;
const CLOTH_HEIGHT = 2.76;
const SEGMENTS_X = 80;
const SEGMENTS_Y = 45;

const tmpPoint = new THREE.Vector3();
const tmpWorldPoint = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();

function recordInteractionDebug(value: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }

  const debugWindow = window as Window & { __clothInteractionDebug?: Record<string, unknown> };
  debugWindow.__clothInteractionDebug = {
    ...debugWindow.__clothInteractionDebug,
    ...value,
    at: Date.now(),
  };
}

export function ClothScene({
  interactionSignal,
  onVariantChange,
  opacity,
  resetSignal,
  settings,
  texture,
  textureVersion,
  variant,
  fanConfig,
  onFanPositionChange,
  onFanRotationChange,
  fanDebugEnabled,
}: ClothSceneProps) {
  const [controlsEnabled, setControlsEnabled] = useState(true);

  return (
    <Canvas
      className="scene-canvas"
      camera={{ fov: 38, position: [0.1, 0.15, 6.1] }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      shadows
    >
      <color attach="background" args={["#f6f7f9"]} />
      <fog attach="fog" args={["#f6f7f9", 7, 12]} />
      <ResponsiveCamera />
      <SceneLighting />
      <ClothRig
        interactionSignal={interactionSignal}
        onVariantChange={onVariantChange}
        opacity={opacity}
        resetSignal={resetSignal}
        settings={settings}
        texture={texture}
        textureVersion={textureVersion}
        variant={variant}
        setControlsEnabled={setControlsEnabled}
        fanConfig={fanConfig}
        onFanPositionChange={onFanPositionChange}
        onFanRotationChange={onFanRotationChange}
        fanDebugEnabled={fanDebugEnabled}
      />
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[0, -1.72, 0.1]}>
        <planeGeometry args={[10, 8]} />
        <shadowMaterial opacity={0.12} />
      </mesh>
      <ContactShadows
        blur={2.8}
        color="#9198a6"
        far={5}
        frames={1}
        opacity={0.28}
        position={[0, -1.69, 0]}
        scale={8}
      />
      <Environment preset="studio" />
      <OrbitControls
        enabled={controlsEnabled}
        enableDamping
        enablePan={false}
        enableZoom={false}
        maxPolarAngle={Math.PI * 0.58}
        minPolarAngle={Math.PI * 0.36}
        target={[0, -0.05, 0]}
      />
    </Canvas>
  );
}

function ResponsiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const isNarrow = size.width < 760;

    perspectiveCamera.fov = isNarrow ? 48 : 38;
    perspectiveCamera.position.set(isNarrow ? 0.18 : 0.1, isNarrow ? 0.06 : 0.15, isNarrow ? 9.4 : 6.1);
    perspectiveCamera.lookAt(0, -0.08, 0);
    perspectiveCamera.updateProjectionMatrix();
  }, [camera, size.width]);

  return null;
}

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={1.2} />
      <rectAreaLight height={4} intensity={3.4} position={[-2.8, 2.4, 3.3]} rotation={[-0.55, -0.55, -0.12]} width={5} />
      <directionalLight
        castShadow
        intensity={2.2}
        position={[2.7, 3.3, 3.8]}
        shadow-camera-bottom={-4}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <pointLight color="#c9ddff" intensity={0.42} position={[3, 0.2, 1.8]} />
    </>
  );
}

function ClothRig({
  interactionSignal,
  onVariantChange,
  opacity,
  resetSignal,
  settings,
  setControlsEnabled,
  texture,
  textureVersion,
  variant,
  fanConfig,
  onFanPositionChange,
  onFanRotationChange,
  fanDebugEnabled,
}: ClothSceneProps & { setControlsEnabled: (enabled: boolean) => void }) {
  const { camera, gl } = useThree();
  const simulation = useMemo(
    () =>
      new ClothSimulation({
        height: CLOTH_HEIGHT,
        segmentsX: SEGMENTS_X,
        segmentsY: SEGMENTS_Y,
        width: CLOTH_WIDTH,
      }),
    [],
  );
  const fallbackTexture = useMemo(() => createFallbackTexture(), []);
  const wrinkleTexture = useMemo(() => createWrinkleTexture(), []);
  const geometry = useMemo(() => createClothGeometry(simulation), [simulation]);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const handleRef = useRef<THREE.Mesh>(null);
  const dragState = useRef<{ active: boolean; pointerId: number | null }>({ active: false, pointerId: null });
  const dragPlane = useRef(new THREE.Plane());
  const dragStartWorld = useRef(new THREE.Vector3());
  const dragDistance = useRef(0);
  const pendingClickUv = useRef<THREE.Vector2 | null>(null);
  const pendingClickLocal = useRef(new THREE.Vector3());
  const fade = useRef(1);

  // Fan references
  const fanGroupRef = useRef<THREE.Group>(null);
  const fanEmitter = useRef<FanEmitter>(buildFanEmitter(fanConfig));
  const clothGroupRef = useRef<THREE.Group>(null);
  const _localEmitter = useRef<FanEmitter>(buildFanEmitter(fanConfig));

  // Rebuild fan emitter when config changes
  useEffect(() => {
    fanEmitter.current = buildFanEmitter(fanConfig);
  }, [fanConfig]);

  const setCursor = useCallback(
    (cursor: "auto" | "grab" | "grabbing") => {
      gl.domElement.style.cursor = cursor;
    },
    [gl],
  );

  useEffect(() => {
    return () => {
      gl.domElement.style.cursor = "";
    };
  }, [gl]);

  useEffect(() => {
    simulation.reset();
  }, [resetSignal, simulation]);

  useEffect(() => {
    fade.current = 0;
    simulation.pulse(0.1);
  }, [simulation, textureVersion]);

  useEffect(() => {
    if (interactionSignal > 0) {
      simulation.applyImpulse(new THREE.Vector3(0.6, -0.2, 0.08), 1.2, 0.14);
    }
  }, [interactionSignal, simulation]);

  const localPointFromWorld = useCallback((point: THREE.Vector3) => {
    tmpPoint.copy(point);
    meshRef.current?.worldToLocal(tmpPoint);
    return tmpPoint;
  }, []);

  const beginDrag = useCallback(
    (event: ThreeEvent<PointerEvent>, directIndex?: number) => {
      if (event.nativeEvent.button > 0) {
        return;
      }

      event.stopPropagation();
      event.nativeEvent.preventDefault();
      gl.domElement.setPointerCapture?.(event.pointerId);

      const localPoint =
        directIndex !== undefined ? simulation.getParticlePosition(directIndex).clone() : localPointFromWorld(event.point).clone();
      const nearest = directIndex ?? simulation.findNearestParticle(localPoint, 0.82);

      if (nearest === null || !simulation.grabParticle(nearest, localPoint)) {
        recordInteractionDebug({ type: "pointerDownMiss", local: localPoint.toArray(), uv: event.uv?.toArray() ?? null });
        return;
      }

      const planePoint =
        directIndex !== undefined && meshRef.current
          ? meshRef.current.localToWorld(localPoint.clone())
          : tmpWorldPoint.copy(event.point);
      camera.getWorldDirection(tmpNormal).normalize();
      dragPlane.current.setFromNormalAndCoplanarPoint(tmpNormal, planePoint);
      dragStartWorld.current.copy(planePoint);
      dragDistance.current = 0;
      pendingClickUv.current = directIndex === undefined && event.uv ? event.uv.clone() : null;
      pendingClickLocal.current.copy(localPoint);
      recordInteractionDebug({
        grabbedIndex: nearest,
        local: localPoint.toArray(),
        type: directIndex === undefined ? "clothPointerDown" : "handlePointerDown",
        uv: pendingClickUv.current?.toArray() ?? null,
      });
      dragState.current = { active: true, pointerId: event.pointerId };
      setControlsEnabled(false);
      setCursor("grabbing");
      simulation.setHoverPoint(null);
    },
    [camera, gl, localPointFromWorld, setControlsEnabled, setCursor, simulation],
  );

  const movePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (dragState.current.active) {
        event.stopPropagation();
        event.nativeEvent.preventDefault();
        const hit = event.ray.intersectPlane(dragPlane.current, tmpWorldPoint);
        if (hit && meshRef.current) {
          dragDistance.current = Math.max(dragDistance.current, dragStartWorld.current.distanceTo(tmpWorldPoint));
          simulation.dragGrabbedParticle(meshRef.current.worldToLocal(tmpPoint.copy(tmpWorldPoint)));
        }
      } else {
        simulation.setHoverPoint(localPointFromWorld(event.point).clone());
        setCursor("grab");
      }
    },
    [localPointFromWorld, setCursor, simulation],
  );

  const endDrag = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      gl.domElement.releasePointerCapture?.(event.pointerId);
      const clickedVariant =
        dragDistance.current < 0.045 && pendingClickUv.current ? variantFromTextureUv(pendingClickUv.current) : null;
      recordInteractionDebug({
        clickedVariant,
        dragDistance: dragDistance.current,
        type: "pointerUp",
        uv: pendingClickUv.current?.toArray() ?? null,
      });
      dragState.current = { active: false, pointerId: null };
      setControlsEnabled(true);
      setCursor("grab");
      simulation.releaseParticle();
      if (clickedVariant) {
        onVariantChange(clickedVariant);
        simulation.applyImpulse(pendingClickLocal.current, 0.85, 0.12);
      }
    },
    [gl, onVariantChange, setControlsEnabled, setCursor, simulation],
  );

  const clickTexture = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (dragDistance.current >= 0.045 || !event.uv) {
        return;
      }

      const clickedVariant = variantFromTextureUv(event.uv);
      recordInteractionDebug({
        clickVariant: clickedVariant,
        dragDistance: dragDistance.current,
        type: "meshClick",
        uv: event.uv.toArray(),
      });
      if (!clickedVariant) {
        return;
      }

      event.stopPropagation();
      onVariantChange(clickedVariant);
      simulation.applyImpulse(localPointFromWorld(event.point).clone(), 0.85, 0.12);
    },
    [localPointFromWorld, onVariantChange, simulation],
  );

  const leavePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (dragState.current.active) {
        endDrag(event);
        return;
      }

      simulation.setHoverPoint(null);
      setCursor("auto");
    },
    [endDrag, setCursor, simulation],
  );

  // Sync fan group position back to parent
  const handleFanDragStart = useCallback(() => {
    setControlsEnabled(false);
    setCursor("grabbing");
  }, [setControlsEnabled, setCursor]);

  const handleFanDragEnd = useCallback(() => {
    setControlsEnabled(true);
    setCursor("grab");
    // Read the fan group's world position and propagate to parent
    if (fanGroupRef.current) {
      const pos = fanGroupRef.current.position;
      onFanPositionChange(pos.x, pos.y, pos.z);
    }
  }, [setControlsEnabled, setCursor, onFanPositionChange]);

  useFrame((state, delta) => {
    // Transform fan position/direction into cloth group's local space
    const safeDelta = Math.min(delta, 1 / 30);
    if (clothGroupRef.current) {
      const localPos = clothGroupRef.current.worldToLocal(fanEmitter.current.position.clone());
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(clothGroupRef.current.matrixWorld);
      const localDir = fanEmitter.current.direction.clone().applyMatrix3(normalMatrix).normalize();
      _localEmitter.current = {
        ...fanEmitter.current,
        position: localPos,
        direction: localDir,
      };
    }

    simulation.update(delta, state.clock.elapsedTime, settings, _localEmitter.current);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    simulation.writePositions(position.array as Float32Array);
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    fade.current = Math.min(1, fade.current + delta * 1.75);
    if (materialRef.current) {
      materialRef.current.opacity = opacity * (0.58 + 0.42 * easeOutCubic(fade.current));
      materialRef.current.bumpScale = settings.wrinkleIntensity;
      materialRef.current.map = texture ?? fallbackTexture;
      materialRef.current.map.needsUpdate = true;
    }

    const handle = handleRef.current;
    if (handle) {
      const handlePosition = simulation.getParticlePosition(simulation.bottomRightIndex);
      handle.position.copy(handlePosition);
      handle.position.z += 0.045;
    }
  });

  return (
    <>
      <FanComponent
        config={fanConfig}
        fanGroupRef={fanGroupRef}
        onDragStart={handleFanDragStart}
        onDragEnd={handleFanDragEnd}
        debugMode={fanDebugEnabled}
      />
      <group ref={clothGroupRef} rotation={[0.03, -0.22, -0.035]} position={[0, 0.12, 0]}>
      <Line
        color="#868c96"
        lineWidth={1}
        points={[
          [-3.45, CLOTH_HEIGHT / 2 + 0.18, -0.06],
          [3.45, CLOTH_HEIGHT / 2 + 0.18, -0.06],
        ]}
        transparent
        opacity={0.68}
      />
      <Line
        color="#aeb4bd"
        lineWidth={1}
        points={[
          [-CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 + 0.16, -0.04],
          [-CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 - 0.02, 0.01],
        ]}
      />
      <Line
        color="#aeb4bd"
        lineWidth={1}
        points={[
          [CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 + 0.16, -0.04],
          [CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 - 0.02, 0.01],
        ]}
      />
      <Clip position={[-CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 + 0.03, 0.04]} />
      <Clip position={[CLOTH_WIDTH / 2, CLOTH_HEIGHT / 2 + 0.03, 0.04]} />

      <mesh
        ref={meshRef}
        castShadow
        receiveShadow
        geometry={geometry}
        onClick={clickTexture}
        onPointerDown={beginDrag}
        onPointerEnter={() => !dragState.current.active && setCursor("grab")}
        onPointerLeave={leavePointer}
        onPointerMove={movePointer}
        onPointerOut={leavePointer}
        onPointerUp={endDrag}
      >
        <meshPhysicalMaterial
          ref={materialRef}
          bumpMap={wrinkleTexture}
          clearcoat={0.62}
          clearcoatRoughness={0.28}
          color="#eef2f6"
          ior={1.42}
          map={texture ?? fallbackTexture}
          metalness={0.05}
          opacity={opacity}
          roughness={0.25}
          side={THREE.DoubleSide}
          thickness={0.4}
          transparent
          transmission={0.12}
        />
      </mesh>

      <mesh
        ref={handleRef}
        castShadow
        onPointerDown={(event) => beginDrag(event, simulation.bottomRightIndex)}
        onPointerEnter={() => !dragState.current.active && setCursor("grab")}
        onPointerLeave={leavePointer}
        onPointerMove={movePointer}
        onPointerUp={endDrag}
      >
        <sphereGeometry args={[0.075, 24, 16]} />
        <meshStandardMaterial color="#2f6cff" metalness={0.12} roughness={0.22} />
      </mesh>
    </group>
    </>
  );
}

function variantFromTextureUv(uv: THREE.Vector2): PageVariant | null {
  const { x: u, y: v } = uv;

  if (v > 0.82) {
    if (u > 0.72 && u < 0.79) {
      return "hero";
    }
    if (u >= 0.79 && u < 0.89) {
      return "performance";
    }
    if (u >= 0.89 && u < 0.97) {
      return "webgl";
    }
  }

  if (u > 0.07 && u < 0.25 && v > 0.28 && v < 0.44) {
    return "performance";
  }

  if (u >= 0.25 && u < 0.45 && v > 0.28 && v < 0.44) {
    return "webgl";
  }

  return null;
}

function Clip({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.1, 0.18, 0.08]} />
        <meshStandardMaterial color="#30343a" metalness={0.55} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.015, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.035, 24]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.1} roughness={0.2} />
      </mesh>
    </group>
  );
}

function Line({
  color,
  lineWidth,
  points,
  transparent,
  opacity,
}: {
  color: string;
  lineWidth: number;
  points: number[][];
  transparent?: boolean;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return geo;
  }, [points]);

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color={color} transparent={transparent} opacity={opacity} />
    </line>
  );
}

function createClothGeometry(simulation: ClothSimulation) {
  const { segmentsX, segmentsY } = simulation.options;
  const positions = new Float32Array((segmentsX + 1) * (segmentsY + 1) * 3);
  const uvs = new Float32Array((segmentsX + 1) * (segmentsY + 1) * 2);
  const indices: number[] = [];

  simulation.writePositions(positions);

  for (let y = 0; y <= segmentsY; y += 1) {
    for (let x = 0; x <= segmentsX; x += 1) {
      const index = y * (segmentsX + 1) + x;
      uvs[index * 2] = x / segmentsX;
      uvs[index * 2 + 1] = 1 - y / segmentsY;
    }
  }

  for (let y = 0; y < segmentsY; y += 1) {
    for (let x = 0; x < segmentsX; x += 1) {
      const a = y * (segmentsX + 1) + x;
      const b = a + 1;
      const c = a + (segmentsX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createFallbackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(245,247,250,0.92)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = "700 92px Inter, Arial, sans-serif";
  ctx.fillText("HTML in Canvas", 96, 225);
  ctx.font = "400 34px Inter, Arial, sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText("Experience true, interactive, art-directed HTML in your WebGL scenes.", 98, 292);
  ctx.fillStyle = "#2f6cff";
  roundRect(ctx, 96, 362, 214, 62, 31);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 24px Inter, Arial, sans-serif";
  ctx.fillText("View Proposal", 126, 402);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createWrinkleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 650; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const length = 24 + Math.random() * 110;
    const alpha = 0.035 + Math.random() * 0.09;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.5);
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(30,34,40,${alpha})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(-length / 2, 0);
    ctx.quadraticCurveTo(0, (Math.random() - 0.5) * 10, length / 2, (Math.random() - 0.5) * 6);
    ctx.stroke();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.8, 2.4);
  texture.needsUpdate = true;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, y, x, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}
