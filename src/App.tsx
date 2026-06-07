import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { RotateCcw, Sparkles, Waves, Wind, Fan } from "lucide-react";
import { ClothRuntimeConfig, FanEmitterConfig, DEFAULT_FAN_CONFIG } from "./physics/cloth";
import { ClothScene } from "./components/ClothScene";
import { PageTexture, PageVariant } from "./components/PageTexture";

const VARIANTS: Array<{ id: PageVariant; label: string }> = [
  { id: "hero", label: "Hero" },
  { id: "performance", label: "Performance" },
  { id: "webgl", label: "WebGL" },
];

const DEFAULT_SETTINGS: ClothRuntimeConfig = {
  damping: 0.982,
  gravity: 3.8,
  stiffness: 0.86,
  windStrength: 0.62,
  wrinkleIntensity: 0.044,
};

export default function App() {
  const [variant, setVariant] = useState<PageVariant>("hero");
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [textureVersion, setTextureVersion] = useState(0);
  const [interactionSignal, setInteractionSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [opacity, setOpacity] = useState(0.82);
  const [settings, setSettings] = useState<ClothRuntimeConfig>(DEFAULT_SETTINGS);
  const [fanConfig, setFanConfig] = useState<FanEmitterConfig>(DEFAULT_FAN_CONFIG);
  const [fanDebugEnabled, setFanDebugEnabled] = useState(false);
  const wheelLock = useRef(false);

  const handleTextureReady = useCallback((nextTexture: THREE.CanvasTexture) => {
    setTexture((currentTexture) => {
      currentTexture?.dispose();
      return nextTexture;
    });
    setTextureVersion((version) => version + 1);
  }, []);

  const updateSetting = useCallback(<T extends keyof ClothRuntimeConfig>(key: T, value: ClothRuntimeConfig[T]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const updateFanConfig = useCallback(<K extends keyof FanEmitterConfig>(key: K, value: FanEmitterConfig[K]) => {
    setFanConfig((current) => ({ ...current, [key]: value }));
  }, []);

  const requestVariant = useCallback((nextVariant: PageVariant) => {
    setVariant(nextVariant);
    setInteractionSignal((value) => value + 1);
  }, []);

  const cycleVariant = useCallback((direction: 1 | -1) => {
    setVariant((current) => {
      const index = VARIANTS.findIndex((item) => item.id === current);
      return VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length].id;
    });
    setInteractionSignal((value) => value + 1);
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement || Math.abs(event.deltaY) < 18 || wheelLock.current) {
        return;
      }

      wheelLock.current = true;
      window.setTimeout(() => {
        wheelLock.current = false;
      }, 560);
      cycleVariant(event.deltaY > 0 ? 1 : -1);
    },
    [cycleVariant],
  );

  const handleFanPositionChange = useCallback((x: number, y: number, z: number) => {
    setFanConfig((current) => ({ ...current, posX: x, posY: y, posZ: z }));
  }, []);

  const handleFanRotationChange = useCallback((rotY: number, rotX: number) => {
    setFanConfig((current) => ({ ...current, rotY, rotX }));
  }, []);

  return (
    <main className="app-shell" onWheel={handleWheel}>
      <ClothScene
        interactionSignal={interactionSignal}
        onVariantChange={requestVariant}
        opacity={opacity}
        resetSignal={resetSignal}
        settings={settings}
        texture={texture}
        textureVersion={textureVersion}
        variant={variant}
        fanConfig={fanConfig}
        onFanPositionChange={handleFanPositionChange}
        onFanRotationChange={handleFanRotationChange}
        fanDebugEnabled={fanDebugEnabled}
      />
      <PageTexture variant={variant} onTextureReady={handleTextureReady} />

      <header className="app-topbar">
        <div className="brand-mark">
          <span className="brand-dot" />
          <strong>Canvas Cloth</strong>
        </div>
        <nav className="variant-tabs" aria-label="纹理状态">
          {VARIANTS.map((item) => (
            <button
              key={item.id}
              className={variant === item.id ? "active" : ""}
              onClick={() => requestVariant(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="icon-button" onClick={() => setResetSignal((value) => value + 1)} title="重置布料" type="button">
          <RotateCcw size={17} strokeWidth={2.1} />
        </button>
      </header>

      <aside className="scene-panel">
        <div className="panel-heading">
          <Sparkles size={17} strokeWidth={2.1} />
          <span>材质参数</span>
        </div>
        <ControlSlider
          label="风力"
          max={1.3}
          min={0}
          onChange={(value) => updateSetting("windStrength", value)}
          step={0.01}
          value={settings.windStrength}
        />
        <ControlSlider
          label="柔软度"
          max={0.98}
          min={0.58}
          onChange={(value) => updateSetting("stiffness", value)}
          step={0.01}
          value={settings.stiffness}
        />
        <ControlSlider
          label="阻尼"
          max={0.995}
          min={0.94}
          onChange={(value) => updateSetting("damping", value)}
          step={0.001}
          value={settings.damping}
        />
        <ControlSlider label="透明度" max={0.95} min={0.48} onChange={setOpacity} step={0.01} value={opacity} />
        <ControlSlider
          label="褶皱"
          max={0.09}
          min={0}
          onChange={(value) => updateSetting("wrinkleIntensity", value)}
          step={0.002}
          value={settings.wrinkleIntensity}
        />
      </aside>

      {/* Fan control panel */}
      <aside className="scene-panel fan-panel">
        <div className="panel-heading">
          <Fan size={17} strokeWidth={2.1} />
          <span>风扇参数</span>
        </div>

        <label className="control-toggle">
          <span>风扇开关</span>
          <input
            checked={fanConfig.enabled}
            onChange={(e) => updateFanConfig("enabled", e.target.checked)}
            type="checkbox"
          />
        </label>

        <ControlSlider
          label="Fan Strength"
          max={20}
          min={0}
          onChange={(value) => updateFanConfig("strength", value)}
          step={0.5}
          value={fanConfig.strength}
        />
        <ControlSlider
          label="Fan Radius"
          max={12}
          min={1}
          onChange={(value) => updateFanConfig("radius", value)}
          step={0.5}
          value={fanConfig.radius}
        />
        <ControlSlider
          label="Cone Angle"
          max={90}
          min={5}
          onChange={(value) => updateFanConfig("coneAngle", value)}
          step={1}
          value={fanConfig.coneAngle}
        />
        <ControlSlider
          label="Turbulence"
          max={2}
          min={0}
          onChange={(value) => updateFanConfig("turbulence", value)}
          step={0.05}
          value={fanConfig.turbulence}
        />
        <ControlSlider
          label="Pulse"
          max={1}
          min={0}
          onChange={(value) => updateFanConfig("pulse", value)}
          step={0.05}
          value={fanConfig.pulse}
        />

        <div className="panel-heading fan-pos-heading">
          <span>风扇位置</span>
        </div>
        <ControlSlider
          label="Pos X"
          max={5}
          min={-5}
          onChange={(value) => updateFanConfig("posX", value)}
          step={0.1}
          value={fanConfig.posX}
        />
        <ControlSlider
          label="Pos Y"
          max={3}
          min={-3}
          onChange={(value) => updateFanConfig("posY", value)}
          step={0.1}
          value={fanConfig.posY}
        />
        <ControlSlider
          label="Pos Z"
          max={5}
          min={-5}
          onChange={(value) => updateFanConfig("posZ", value)}
          step={0.1}
          value={fanConfig.posZ}
        />

        <div className="panel-heading fan-pos-heading">
          <span>风扇旋转</span>
        </div>
        <ControlSlider
          label="Rot Y"
          max={Math.PI}
          min={-Math.PI}
          onChange={(value) => updateFanConfig("rotY", value)}
          step={0.05}
          value={fanConfig.rotY}
        />
        <ControlSlider
          label="Rot X"
          max={Math.PI / 2}
          min={-Math.PI / 2}
          onChange={(value) => updateFanConfig("rotX", value)}
          step={0.05}
          value={fanConfig.rotX}
        />

        <label className="control-toggle">
          <span>Debug 可视化</span>
          <input
            checked={fanDebugEnabled}
            onChange={(e) => setFanDebugEnabled(e.target.checked)}
            type="checkbox"
          />
        </label>
      </aside>

      <footer className="scene-status">
        <span>
          <Wind size={15} /> {settings.windStrength.toFixed(2)}
        </span>
        <span>
          <Waves size={15} /> {settings.stiffness.toFixed(2)}
        </span>
      </footer>
    </main>
  );
}

type ControlSliderProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
};

function ControlSlider({ label, max, min, onChange, step, value }: ControlSliderProps) {
  return (
    <label className="control-slider">
      <span>
        {label}
        <strong>{value.toFixed(step < 0.01 ? 3 : 2)}</strong>
      </span>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}
