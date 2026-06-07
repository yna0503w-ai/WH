import { useEffect, useRef } from "react";
import type { CanvasHTMLAttributes, HTMLAttributes } from "react";
import { toCanvas } from "html-to-image";
import * as THREE from "three";

export type PageVariant = "hero" | "performance" | "webgl";

type HtmlPageTextureProps = {
  variant: PageVariant;
  onTextureReady: (texture: THREE.CanvasTexture) => void;
};

type DrawElementCanvasContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, ...rect: number[]) => DOMMatrix;
};

type DrawElementCanvas = HTMLCanvasElement & {
  requestPaint?: () => void;
};

const TEXTURE_WIDTH = 1200;
const TEXTURE_HEIGHT = 675;
const TEXTURE_PIXEL_RATIO = 2;
const CANVAS_LAYOUT_SUBTREE_PROPS = { layoutsubtree: "" } as CanvasHTMLAttributes<HTMLCanvasElement> & {
  layoutsubtree: string;
};
const LAYOUT_SUBTREE_PROPS = { layoutsubtree: "" } as HTMLAttributes<HTMLDivElement> & { layoutsubtree: string };

const VARIANT_COPY: Record<
  PageVariant,
  {
    heading: string;
    subheading: string;
    kicker: string;
    statA: string;
    statB: string;
    statC: string;
  }
> = {
  hero: {
    heading: "HTML in Canvas",
    subheading: "Interactive HTML, rendered inside a living WebGL cloth.",
    kicker: "Proposal 01",
    statA: "DOM texture",
    statB: "Cloth mesh",
    statC: "Live physics",
  },
  performance: {
    heading: "Designed for Performance",
    subheading: "Render the interface once, then let the GPU carry the material, light, and motion.",
    kicker: "Frame budget",
    statA: "80 x 45 grid",
    statB: "Verlet solver",
    statC: "Texture cache",
  },
  webgl: {
    heading: "Interactive HTML in WebGL",
    subheading: "A flexible surface for proposal pages, galleries, product launches, and spatial UI.",
    kicker: "Scene layer",
    statA: "Soft pins",
    statB: "Raycast drag",
    statC: "Gloss film",
  },
};

export function HtmlPageTexture({ variant, onTextureReady }: HtmlPageTextureProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const nativeCanvasRef = useRef<HTMLCanvasElement>(null);
  const nativeElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderTexture() {
      const node = pageRef.current;
      if (!node) {
        return;
      }

      await document.fonts?.ready;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const canvas = await renderHtmlTextureCanvas(node, nativeCanvasRef.current, nativeElementRef.current);

      if (cancelled) {
        return;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      onTextureReady(texture);
    }

    renderTexture().catch((error) => {
      console.error("Could not render HTML texture", error);
    });

    return () => {
      cancelled = true;
    };
  }, [onTextureReady, variant]);

  const copy = VARIANT_COPY[variant];

  return (
    <div className="texture-capture-root" aria-hidden="true">
      <div ref={pageRef} className={`texture-page texture-page--${variant}`}>
        <TexturePageContent copy={copy} />
      </div>
      <canvas ref={nativeCanvasRef} className="texture-native-capture" {...CANVAS_LAYOUT_SUBTREE_PROPS}>
        <div ref={nativeElementRef} className={`texture-page texture-page--${variant}`} {...LAYOUT_SUBTREE_PROPS}>
          <TexturePageContent copy={copy} />
        </div>
      </canvas>
    </div>
  );
}

type TexturePageCopy = (typeof VARIANT_COPY)[PageVariant];

function TexturePageContent({ copy }: { copy: TexturePageCopy }) {
  return (
    <>
      <header className="texture-nav">
        <strong>HTML in Canvas</strong>
        <nav>
          <span>Home</span>
          <span>Performance</span>
          <span>WebGL</span>
          <span>Contact</span>
        </nav>
      </header>

      <main className="texture-main">
        <section className="texture-hero-copy">
          <span className="texture-kicker">{copy.kicker}</span>
          <h1>{copy.heading}</h1>
          <p>{copy.subheading}</p>
          <div className="texture-actions">
            <button>View Proposal</button>
            <button className="texture-secondary-button">Explore Demo</button>
          </div>
        </section>

        <section className="texture-side-panel">
          <div>
            <span>01</span>
            <strong>{copy.statA}</strong>
            <p>Captured as canvas only when the page changes.</p>
          </div>
          <div>
            <span>02</span>
            <strong>{copy.statB}</strong>
            <p>Structural, shear, and bend springs preserve folds.</p>
          </div>
        </section>
      </main>

      <footer className="texture-footer">
        <div>
          <span>Material</span>
          <strong>Semi-transparent glossy film</strong>
        </div>
        <div>
          <span>Interaction</span>
          <strong>{copy.statC}</strong>
        </div>
        <div>
          <span>Render</span>
          <strong>CanvasTexture</strong>
        </div>
      </footer>
    </>
  );
}

async function renderHtmlTextureCanvas(
  fallbackNode: HTMLElement,
  nativeCanvas: HTMLCanvasElement | null,
  nativeElement: HTMLElement | null,
) {
  if (nativeCanvas && nativeElement) {
    const context = nativeCanvas.getContext("2d") as DrawElementCanvasContext | null;
    if (context?.drawElementImage) {
      try {
        return await renderWithDrawElementImage(nativeCanvas as DrawElementCanvas, nativeElement, context);
      } catch (error) {
        console.warn("Falling back to html-to-image after drawElementImage failed.", error);
      }
    }
  }

  return toCanvas(fallbackNode, {
    backgroundColor: "rgba(255,255,255,0)",
    cacheBust: true,
    height: TEXTURE_HEIGHT,
    pixelRatio: TEXTURE_PIXEL_RATIO,
    width: TEXTURE_WIDTH,
  });
}

function renderWithDrawElementImage(
  canvas: DrawElementCanvas,
  element: HTMLElement,
  context: DrawElementCanvasContext,
) {
  canvas.width = TEXTURE_WIDTH * TEXTURE_PIXEL_RATIO;
  canvas.height = TEXTURE_HEIGHT * TEXTURE_PIXEL_RATIO;
  canvas.style.width = `${TEXTURE_WIDTH}px`;
  canvas.style.height = `${TEXTURE_HEIGHT}px`;
  element.style.transform = "";

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      canvas.removeEventListener("paint", draw);
      window.clearTimeout(timeoutId);
    };

    const fail = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error("Timed out while waiting for drawElementImage paint."));
    };

    const draw = () => {
      if (settled) {
        return;
      }

      try {
        context.reset?.();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        let transform: DOMMatrix | undefined;
        try {
          context.scale(TEXTURE_PIXEL_RATIO, TEXTURE_PIXEL_RATIO);
          transform = context.drawElementImage?.(element, 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        } finally {
          context.restore();
        }

        if (!transform) {
          throw new Error("drawElementImage is unavailable on this 2D context.");
        }

        element.style.transform = transform.toString();
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = canvas.width;
        outputCanvas.height = canvas.height;
        outputCanvas.style.width = canvas.style.width;
        outputCanvas.style.height = canvas.style.height;
        outputCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
        settled = true;
        cleanup();
        resolve(outputCanvas);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    };

    const timeoutId = window.setTimeout(fail, 1200);
    canvas.addEventListener("paint", draw, { once: true });
    canvas.requestPaint?.();
  });
}
