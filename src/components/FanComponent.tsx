import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FanEmitterConfig } from "../physics/cloth";

type FanComponentProps = {
  config: FanEmitterConfig;
  fanGroupRef: React.RefObject<THREE.Group | null>;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  debugMode: boolean;
};

export function FanComponent({ config, fanGroupRef, onDragStart, onDragEnd, debugMode }: FanComponentProps) {
  const bladesRef = useRef<THREE.Group>(null);
  const bladeRotation = useRef(0);
  const coneRef = useRef<THREE.Mesh>(null);
  const streamlinesRef = useRef<THREE.Group>(null);

  // Compute direction from rotation
  const direction = useMemo(() => {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(config.rotX, config.rotY, 0, "YXZ"));
    dir.normalize();
    return dir;
  }, [config.rotX, config.rotY]);

  // Cone geometry for debug visualization
  const coneGeometry = useMemo(() => {
    const coneAngle = (config.coneAngle * Math.PI) / 180;
    const radius = config.radius;
    const height = radius * Math.cos(coneAngle);
    const baseRadius = radius * Math.sin(coneAngle);
    const geo = new THREE.ConeGeometry(baseRadius, height, 32, 1, true);
    // Flip cone so wide end faces the fan direction
    geo.translate(0, -height / 2, 0);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [config.coneAngle, config.radius]);

  useFrame((_, delta) => {
    // Spin blades based on strength and enabled state
    if (bladesRef.current) {
      if (config.enabled) {
        bladeRotation.current += delta * config.strength * 1.8;
      } else {
        bladeRotation.current += delta * 0.3; // Slow idle spin when off
      }
      bladesRef.current.rotation.z = bladeRotation.current;
    }

    // Update debug cone
    if (coneRef.current) {
      coneRef.current.visible = debugMode;
      if (debugMode) {
        // Orient cone to face fan direction
        const euler = new THREE.Euler(config.rotX, config.rotY, 0, "YXZ");
        coneRef.current.rotation.copy(euler);
        coneRef.current.position.copy(direction.clone().multiplyScalar(config.radius * 0.5 * Math.cos((config.coneAngle * Math.PI) / 180)));
      }
    }

    // Update streamlines
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
    const gl = (e as any).gl || e;

    // Capture pointer on the canvas
    const canvas = (e as any).nativeEvent?.target?.closest?.("canvas");
    canvas?.setPointerCapture?.(e.pointerId);

    isDragging.current = true;
    onDragStart?.();

    // Set up drag plane facing the camera
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
      onPointerLeave={handlePointerUp}
    >
      {/* Base */}
      <mesh receiveShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.36, 0.44, 0.055, 48]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.36} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.035, 0.044, 0.9, 24]} />
        <meshStandardMaterial color="#eef2f6" roughness={0.28} />
      </mesh>
      {/* Motor housing */}
      <mesh position={[0, 0.94, 0.02]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.105, 0.12, 0.28, 32]} />
        <meshStandardMaterial color="#f7f8fa" roughness={0.22} />
      </mesh>
      {/* Ring guard */}
      <mesh position={[0, 0.94, 0.21]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.27, 0.01, 12, 56]} />
        <meshStandardMaterial color="#d8dde5" metalness={0.08} roughness={0.18} />
      </mesh>

      {/* Blades - rotate with speed */}
      <group ref={bladesRef} position={[0, 0.94, 0.21]} rotation={[0, Math.PI / 2, 0]}>
        {[0, 1, 2].map((blade) => (
          <mesh key={blade} rotation={[0, 0, (blade * Math.PI * 2) / 3]}>
            <boxGeometry args={[0.04, 0.23, 0.012]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.48 * indicatorOpacity} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* Power indicator LED */}
      <mesh position={[0.26, -0.03, 0.11]}>
        <sphereGeometry args={[0.025, 16, 12]} />
        <meshStandardMaterial
          color={config.enabled ? "#7ee4ca" : "#888888"}
          emissive={config.enabled ? "#5cd9bd" : "#444444"}
          emissiveIntensity={config.enabled ? 0.28 : 0.05}
        />
      </mesh>

      {/* Direction arrow helper */}
      <arrowHelper
        args={[direction, new THREE.Vector3(0, 0.94, 0.21), 0.6, config.enabled ? "#2f6cff" : "#888888", 0.12, 0.06]}
      />

      {/* Debug: Wind cone visualization */}
      <mesh ref={coneRef} position={[0, 0.94, 0.21]} visible={debugMode}>
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
      <group ref={streamlinesRef} position={[0, 0.94, 0.21]} visible={debugMode}>
        {Array.from({ length: 5 }).map((_, i) => {
          const angle = ((i - 2) / 4) * ((config.coneAngle * Math.PI) / 180) * 0.7;
          const length = config.strength * 0.12;
          const offsetX = Math.sin(angle) * 0.15;
          const points = [new THREE.Vector3(offsetX, 0, 0), new THREE.Vector3(offsetX, 0, -length)];
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const lineOpacity = Math.min(0.6, config.strength * 0.06);
          return (
            <primitive key={i} object={new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#2f6cff", transparent: true, opacity: lineOpacity }))} />
          );
        })}
      </group>
    </group>
  );
}
