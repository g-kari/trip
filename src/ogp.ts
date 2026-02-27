import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
// @ts-expect-error wasm import - static import for Cloudflare Workers
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

let wasmInitialized = false;

async function initResvg() {
  if (!wasmInitialized) {
    // Cloudflare Workers require WASM to be passed as a pre-compiled WebAssembly.Module
    // The static import above is processed by wrangler's esbuild to create the module
    await initWasm(resvgWasm as unknown as WebAssembly.Module);
    wasmInitialized = true;
  }
}

// Noto Sans JP font (400 weight)
async function loadFont(): Promise<ArrayBuffer> {
  const response = await fetch(
    'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf'
  );
  if (!response.ok) {
    throw new Error(`Failed to load font: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

interface OgpOptions {
  title: string;
  dateRange?: string;
  dayCount?: number;
  subtitle?: string;
  theme: 'quiet' | 'photo' | 'retro' | 'natural';
  coverImageUrl?: string | null;
}

export async function generateOgpImage(options: OgpOptions): Promise<Uint8Array> {
  await initResvg();

  const fontData = await loadFont();

  const { title, dateRange, dayCount, subtitle, theme, coverImageUrl } = options;

  // Theme colors with accent
  const getThemeColors = () => {
    switch (theme) {
      case 'photo':
        return { bgColor: '#1a1a2e', textColor: '#f0f0f0', mutedColor: '#a0a0a0', accentColor: '#e94560' };
      case 'retro':
        return { bgColor: '#f5f0e1', textColor: '#3d2e1f', mutedColor: '#6b5c4a', accentColor: '#c25d30' };
      case 'natural':
        return { bgColor: '#f4f1eb', textColor: '#2d3a2d', mutedColor: '#6b7c6b', accentColor: '#5a7a4a' };
      default: // quiet
        return { bgColor: '#f6f3ee', textColor: '#3d2e1f', mutedColor: '#8c7b6b', accentColor: '#3d2e1f' };
    }
  };
  const { bgColor, textColor, mutedColor, accentColor } = getThemeColors();
  const hasCover = !!coverImageUrl;

  // Truncate title if too long
  const displayTitle = title.length > 25 ? title.slice(0, 25) + '...' : title;

  // Build the element tree (using any to bypass satori's complex types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  // Day count badge (top-right area)
  if (dayCount) {
    children.push({
      type: 'div',
      props: {
        style: {
          fontSize: 20,
          color: hasCover ? '#ffffff' : accentColor,
          letterSpacing: '0.05em',
          marginBottom: 16,
        },
        children: `${dayCount}日間の旅`,
      },
    });
  }

  // Title
  children.push({
    type: 'div',
    props: {
      style: {
        fontSize: 56,
        fontWeight: 600,
        color: hasCover ? '#ffffff' : textColor,
        textAlign: 'center',
        lineHeight: 1.4,
        marginBottom: 16,
      },
      children: displayTitle,
    },
  });

  // Date range
  if (dateRange) {
    children.push({
      type: 'div',
      props: {
        style: {
          fontSize: 28,
          color: hasCover ? '#b0b0b0' : mutedColor,
          marginBottom: 12,
        },
        children: dateRange,
      },
    });
  }

  // Subtitle (areas)
  if (subtitle) {
    children.push({
      type: 'div',
      props: {
        style: {
          fontSize: 22,
          color: hasCover ? '#909090' : mutedColor,
          marginBottom: 24,
          letterSpacing: '0.03em',
        },
        children: subtitle,
      },
    });
  }

  // Accent line
  children.push({
    type: 'div',
    props: {
      style: {
        width: 60,
        height: 3,
        backgroundColor: hasCover ? '#ffffff40' : accentColor,
        marginBottom: 24,
      },
    },
  });

  // Branding
  children.push({
    type: 'div',
    props: {
      style: {
        fontSize: 22,
        color: hasCover ? '#707070' : mutedColor,
        letterSpacing: '0.15em',
        marginTop: 'auto',
      },
      children: '旅程',
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element: any = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hasCover ? '#1a1a1a' : bgColor,
        padding: 60,
        fontFamily: 'Noto Sans JP',
      },
      children,
    },
  };

  // Generate SVG
  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Noto Sans JP',
        data: fontData,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Noto Sans JP',
        data: fontData,
        weight: 600,
        style: 'normal',
      },
    ],
  });

  // Convert SVG to PNG
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: 1200,
    },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}
