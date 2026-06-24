import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FanEmitterConfig } from "../physics/cloth";

type FanComponentProps = {
  config: FanEmitterConfig;
  fanGroupRef: React.RefObject<THREE.Group | null>;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  debugMode: boolean;
};

export function FanComponent({ config, fanGroupRef, onDragStart, onDragEnd, onHoverStart, onHoverEnd, debugMode }: FanComponentProps) {
  const bladesRef = useRef<THREE.Group>(null);
  const bladeRotation = useRef(0);
  const coneRef = useRef<THREE.Mesh>(null);
  const streamlinesRef = useRef<THREE.Group>(null);

  // Cone geometry for debug visualization — opens toward local -Z
  const coneGeometry = useMemo(() => {
    const coneAngle = (config.coneAngle * Math.PI) / 180;
    const radius = config.radius;
    const height = radius * Math.cos(coneAngle);
    const baseRadius = radius * Math.sin(coneAngle);
    const geo = new THREE.ConeGeometry(baseRadius, height, 32, 1, true);
    geo.translate(0, -height / 2, 0);
    geo.rotateX(Math.PI / 2); // open toward -Z
    return geo;
  }, [config.coneAngle, config.radius]);

  useFrame((_, delta) => {
    // Spin blades based on strength and enabled state
    if (bladesRef.current) {
      if (config.enabled) {
        bladeRotation.current += delta * config.strength * 2.5;
      } else {
        bladeRotation.current += delta * 0.3; // Slow idle spin when off
      }
      bladesRef.current.rotation.z = bladeRotation.current;
    }

    // Update debug cone visibility
    if (coneRef.current) {
      coneRef.current.visible = debugMode;
    }
    if (streamlinesRef.current) {
      streamlinesRef.current.visible = debugMode;
    }
  });

  const isDragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane());
  const dragOffset = useRef(new THREE.Vector3());

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    const canvas = (e as any).nativeEvent?.target?.closest?.("canvas");
    canvas?.setPointerCapture?.(e.pointerId);
    isDragging.current = true;
    onDragStart?.();
    const camera = (e as any).camera;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    dragPlane.current.setFromNormalAndCoplanarPoint(camDir, fanGroupRef.current?.position || new THREE.Vector3());
  };

  const handlePointerMove = (e: any) => {
    if (!isDragging.current || !fanGroupRef.current) return;
    e.stopPropagation();
    const worldPoint = new THREE.Vector3();
    const hit = e.ray.intersectPlane(dragPlane.current, worldPoint);
    if (hit && fanGroupRef.current) {
      fanGroupRef.current.position.copy(worldPoint);
    }
  };

  const handlePointerUp = (e: any) => {
    if (!isDragging.current) return;
    e.stopPropagation();
    isDragging.current = false;
    onDragEnd?.();
  };

  const handlePointerEnter = (e: any) => {
    e.stopPropagation();
    onHoverStart?.();
  };

  const handlePointerLeave = (e: any) => {
    e.stopPropagation();
    if (isDragging.current) {
      handlePointerUp(e);
    }
    onHoverEnd?.();
  };

  const indicatorOpacity = config.enabled ? 1 : 0.35;

  return (
    <group
      ref={fanGroupRef}
      position={[config.posX, config.posY, config.posZ]}
      rotation={[config.rotX, config.rotY, 0]}
      scale={0.82}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* Invisible enlarged hit area for easier interaction */}
      <mesh visible={false} position={[0, 0.5, 0]}>
        <boxGeometry args={[0.9, 1.3, 0.5]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Base — flat disc on ground */}
      <mesh receiveShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0.028, 0]}>
        <cylinderGeometry args={[0.36, 0.44, 0.055, 48]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.36} />
      </mesh>

      {/* Pole */}
      <mesh position={[0, 0.47, 0]}>
        <cylinderGeometry args={[0.035, 0.044, 0.88, 24]} />
        <meshStandardMaterial color="#eef2f6" roughness={0.28} />
      </mesh>

      {/* Motor housing — cylinder along local Z (behind the grill) */}
      <mesh position={[0, 0.94, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.11, 0.12, 0.24, 32]} />
        <meshStandardMaterial color="#f7f8fa" roughness={0.22} />
      </mesh>

      {/* Ring guard — torus in XY plane (perpendicular to blow direction -Z) */}
      <mesh position={[0, 0.94, 0]}>
        <torusGeometry args={[0.27, 0.012, 12, 56]} />
        <meshStandardMaterial color="#d8dde5" metalness={0.08} roughness={0.18} />
      </mesh>

      {/* Blades — rotate around local Z axis */}
      <group ref={bladesRef} position={[0, 0.94, 0]}>
        {[0, 1, 2].map((blade) => (
          <mesh key={blade} rotation={[0, 0, (blade * Math.PI * 2) / 3]} position={[0.1, 0, 0]}>
            <boxGeometry args={[0.22, 0.035, 0.008]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.48 * indicatorOpacity} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* Power indicator LED — on base front edge */}
      <mesh position={[0.3, 0.03, 0]}>
        <sphereGeometry args={[0.025, 16, 12]} />
        <meshStandardMaterial
          color={config.enabled ? "#7ee4ca" : "#888888"}
          emissive={config.enabled ? "#5cd9bd" : "#444444"}
          emissiveIntensity={config.enabled ? 0.28 : 0.05}
        />
      </mesh>

      {/* Direction arrow — points in local -Z (group rotation maps to world direction) */}
      <arrowHelper
        args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.94, 0.05), 0.5, config.enabled ? "#2f6cff" : "#888888", 0.1, 0.05]}
      />

      {/* Debug: Wind cone visualization */}
      <mesh ref={coneRef} position={[0, 0.94, 0]} visible={debugMode}>
        <primitive object={coneGeometry} attach="geometry" />
        <meshBasicMaterial
          color="#2f6cff"
          transparent
          opacity={0.08}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Debug: Streamlines */}
      <group ref={streamlinesRef} position={[0, 0.94, 0]} visible={debugMode}>
        {Array.from({ length: 6 }).map((_, i) => {
          // Spread streamline angles symmetrically around the cone
          const angle = ((i - 2.5) / 5) * ((config.coneAngle * Math.PI) / 180) * 0.75;
          return (
            <Streamline
              key={i}
              angle={angle}
              config={config}
              index={i}
            />
          );
        })}
      </group>
    </group>
  );
}

type StreamlineProps = {
  angle: number;
  config: FanEmitterConfig;
  index: number;
};

function Streamline({ angle, config, index }: StreamlineProps) {
  const lineRef = useRef<THREE.Line>(null);

  // Buffer geometry with 2 points (start, end)
  const geometry = useMemo(() => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);

  const baseLineOpacity = Math.min(0.65, config.strength * 0.08);

  useFrame((state) => {
    if (!lineRef.current || !config.enabled) return;

    // Streamline flow speed scales with wind strength
    const speed = 1.2 + config.strength * 0.5;
    const maxZ = -config.radius;

    // Stagger starts for each streamline using index
    const progress = (state.clock.elapsedTime * speed + index * 0.95) % config.radius;

    // Determine the start and end of the line segment along local -Z
    const segmentLength = 0.45 + config.strength * 0.04;
    const startZ = -progress;
    const endZ = Math.max(maxZ, -progress - segmentLength);

    // Calculate radial spreading based on cone angle
    const coneAngleRad = (config.coneAngle * Math.PI) / 180;
    const startSpread = Math.tan(coneAngleRad) * Math.abs(startZ) * 0.85;
    const endSpread = Math.tan(coneAngleRad) * Math.abs(endZ) * 0.85;

    // Center offset to keep them inside the cone but spread out
    const dirX = Math.sin(angle);
    const dirY = Math.cos(angle);

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;

    // Update start vertex
    posAttr.setXYZ(0, dirX * startSpread, dirY * startSpread, startZ);
    // Update end vertex
    posAttr.setXYZ(1, dirX * endSpread, dirY * endSpread, endZ);

    posAttr.needsUpdate = true;

    // Fade out as the segment approaches its maximum radius
    const fadeOut = 1 - Math.min(1, Math.abs(startZ) / config.radius);
    const mat = lineRef.current.material as THREE.LineBasicMaterial;
    mat.opacity = baseLineOpacity * fadeOut;
  });

  return (
    <primitive
      ref={lineRef}
      object={
        new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: "#2f6cff",
            transparent: true,
            opacity: baseLineOpacity,
            linewidth: 1,
          })
        )
      }
    />
  );
}
