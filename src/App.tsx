import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { RotateCcw, Sparkles, Waves, Wind } from "lucide-react";
import { ClothRuntimeConfig } from "./physics/cloth";
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
