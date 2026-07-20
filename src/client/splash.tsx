import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { fetchBootstrap } from './state/api';

type SplashData = {
  /** The viewing user's real Reddit username (server-resolved). */
  username: string;
  finalized: boolean;
};

// ---- shared drawing tokens -------------------------------------------------
// A single warm, hand-drawn cartoon language: one dark outline colour, rounded
// joins, flat fills + a lighter highlight per object. Everything is inline SVG
// so it renders identically on every device with zero external assets.
const OUT = '#3a2b20'; // object outline (dark warm brown)
const INK = '#2f2540'; // deep aubergine text

type SvgProps = { className?: string; style?: CSSProperties };

const strokeCommon = {
  stroke: OUT,
  strokeWidth: 4,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
  fill: 'none',
};

/** A crisp 5-point star, placed at (cx,cy) and scaled to `size`. */
const Star5 = ({ cx, cy, size, fill }: { cx: number; cy: number; size: number; fill: string }) => {
  const s = size / 24;
  return (
    <path
      transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${s})`}
      d="M12 2 l2.94 6.36 L22 9.27 l-5 4.87 L18.18 21 L12 17.27 L5.82 21 L7 14.14 l-5 -4.87 l7.06 -0.91 Z"
      fill={fill}
    />
  );
};

/** A four-point twinkle used for the scattered background sparkles. */
const Sparkle = ({ className, size = 14, color }: SvgProps & { size?: number; color: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
    <path
      d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z"
      fill={color}
    />
  </svg>
);

// ---- the little "One More Thing" armchair mascot ---------------------------
const Mascot = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 60 54" className={className} style={style} aria-hidden>
    <g {...strokeCommon} strokeWidth={3}>
      <rect x="6" y="10" width="10" height="28" rx="5" fill="#e0592f" />
      <rect x="44" y="10" width="10" height="28" rx="5" fill="#e0592f" />
      <rect x="14" y="3" width="32" height="22" rx="8" fill="#e0592f" />
      <rect x="8" y="22" width="44" height="18" rx="6" fill="#ef6a3d" />
      <circle cx="25" cy="15" r="1.8" fill={OUT} stroke="none" />
      <circle cx="35" cy="15" r="1.8" fill={OUT} stroke="none" />
      <path d="M24 19 Q30 23 36 19" strokeWidth={2.4} />
      <rect x="12" y="40" width="6" height="7" rx="2" fill="#e0592f" />
      <rect x="42" y="40" width="6" height="7" rx="2" fill="#e0592f" />
    </g>
  </svg>
);

// ---- logo ------------------------------------------------------------------
const Logo = ({ className }: SvgProps) => (
  <div className={`flex items-center gap-1 ${className ?? ''}`}>
    <Mascot className="h-11 w-11 shrink-0 drop-shadow-sm" />
    {/* viewBox is tall enough to include the descenders (the "g" in More/Thing). */}
    <svg viewBox="0 0 150 104" className="h-[70px] w-[104px] shrink-0" aria-hidden>
      <g
        fontFamily='"Baloo 2", "Nunito", system-ui, sans-serif'
        fontWeight={900}
        fontStyle="italic"
        fontSize={30}
        strokeLinejoin="round"
      >
        {/* Dark keyline pass behind the white sticker border. */}
        <g fill="none" stroke={INK} strokeWidth={11}>
          <text x="6" y="28">One</text>
          <text x="6" y="58">More</text>
          <text x="6" y="88">Thing</text>
        </g>
        {/* White border + coloured fill via paint-order. */}
        <g stroke="#fff" strokeWidth={6} style={{ paintOrder: 'stroke' }}>
          <text x="6" y="28" fill={INK}>One</text>
          <text x="6" y="58" fill="#f2b418">More</text>
          <text x="6" y="88" fill={INK}>Thing</text>
        </g>
      </g>
    </svg>
  </div>
);

// ---- leaderboard trophy (top-right) ----------------------------------------
const Trophy = ({ className }: SvgProps) => (
  <svg viewBox="0 0 64 74" className={className} aria-hidden>
    <g {...strokeCommon}>
      <path d="M16 16 C4 16 4 34 20 36" />
      <path d="M48 16 C60 16 60 34 44 36" />
      <path d="M16 8 H48 V24 C48 36 41 42 32 42 C23 42 16 36 16 24 Z" fill="#f4c02c" />
      <rect x="27" y="42" width="10" height="10" fill="#e8a91b" />
      <rect x="18" y="52" width="28" height="8" rx="3" fill="#f4c02c" />
      <rect x="13" y="60" width="38" height="8" rx="3" fill="#f4c02c" />
      <Star5 cx={32} cy={23} size={15} fill={OUT} />
    </g>
  </svg>
);

// ---- the stacked-object tower ----------------------------------------------
const Lamp = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 110 132" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <path d="M30 12 H80 L96 54 H14 Z" fill="#f1e7cf" />
      <path d="M14 54 H96" />
      <rect x="49" y="54" width="12" height="34" fill="#ecb636" />
      <path d="M28 120 Q55 78 82 120 Z" fill="#ecb636" />
      <ellipse cx="55" cy="120" rx="30" ry="9" fill="#ecb636" />
      <path d="M36 20 L30 50" strokeWidth={2.5} stroke="#d9cba8" />
    </g>
  </svg>
);

const Plant = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 84 108" className={className} style={style} aria-hidden>
    <g {...strokeCommon} strokeWidth={3.5} fill="#5aa24a">
      <path d="M42 60 C18 56 8 30 26 16 C38 30 46 46 42 60 Z" />
      <path d="M42 60 C66 56 76 30 58 16 C46 30 38 46 42 60 Z" />
      <path d="M42 60 C40 32 42 12 42 6 C52 20 54 42 42 60 Z" />
    </g>
    <g {...strokeCommon}>
      <path d="M20 62 H64 L58 100 H26 Z" fill="#c87c47" />
      <rect x="15" y="55" width="54" height="11" rx="3" fill="#d68a54" />
    </g>
  </svg>
);

const Frame = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 96 112" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <rect x="10" y="10" width="76" height="92" rx="6" fill="#c68f3f" />
      <rect x="20" y="20" width="56" height="72" rx="3" fill="#bfe3f4" />
      <circle cx="62" cy="36" r="7" fill="#f4c02c" />
      <ellipse cx="34" cy="34" rx="9" ry="4.5" fill="#ffffff" strokeWidth={3} />
      <path d="M20 92 L36 62 L50 82 L60 68 L76 92 Z" fill="#6bbf5b" strokeWidth={3.5} />
    </g>
  </svg>
);

const Box = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 148 104" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <rect x="16" y="34" width="108" height="64" rx="6" fill="#d8a869" />
      <path d="M16 34 L34 18 L142 18 L124 34 Z" fill="#e6bd85" />
      <path d="M70 18 V98" strokeWidth={3} stroke="#c49155" />
      <rect x="30" y="54" width="26" height="20" rx="3" fill="#f0e6cf" />
      <path d="M98 78 l7 -9 l7 9 M105 69 v18" strokeWidth={3} />
    </g>
  </svg>
);

const Book = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 152 44" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <rect x="8" y="10" width="136" height="24" rx="6" fill="#c8492f" />
      <rect x="8" y="27" width="136" height="9" rx="4" fill="#f2e8d0" />
      <path d="M22 17 H130" strokeWidth={3} stroke="#eab63a" />
    </g>
  </svg>
);

const Microwave = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 172 106" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <rect x="6" y="8" width="160" height="90" rx="12" fill="#ece9e2" />
      <rect x="16" y="18" width="98" height="70" rx="8" fill="#3c3a42" />
      <rect x="24" y="26" width="82" height="54" rx="5" fill="#57555f" />
      <rect x="120" y="18" width="8" height="70" rx="3" fill="#cbc8c0" />
      <rect x="132" y="18" width="30" height="70" rx="6" fill="#f7f5ef" />
      <rect x="136" y="24" width="22" height="12" rx="2" fill="#25301f" />
      <circle cx="141" cy="50" r="2.4" fill="#c9c6be" stroke="none" />
      <circle cx="149" cy="50" r="2.4" fill="#c9c6be" stroke="none" />
      <circle cx="141" cy="60" r="2.4" fill="#c9c6be" stroke="none" />
      <circle cx="149" cy="60" r="2.4" fill="#c9c6be" stroke="none" />
      <circle cx="141" cy="70" r="2.4" fill="#c9c6be" stroke="none" />
      <circle cx="149" cy="70" r="2.4" fill="#c9c6be" stroke="none" />
    </g>
    <text
      x="147"
      y="34"
      textAnchor="middle"
      fontFamily="ui-monospace, monospace"
      fontSize="9"
      fontWeight={700}
      fill="#7bef7b"
    >
      02:30
    </text>
  </svg>
);

const Chair = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 130 124" className={className} style={style} aria-hidden>
    <g {...strokeCommon} fill="#cf9f4e">
      <rect x="30" y="6" width="11" height="72" rx="4" />
      <rect x="89" y="6" width="11" height="72" rx="4" />
      <rect x="30" y="14" width="70" height="10" rx="4" />
      <rect x="30" y="36" width="70" height="9" rx="4" />
      <rect x="22" y="72" width="86" height="15" rx="5" />
      <rect x="30" y="87" width="11" height="33" rx="4" />
      <rect x="89" y="87" width="11" height="33" rx="4" />
    </g>
  </svg>
);

const Pillow = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 152 74" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <path
        d="M18 14 C40 4 112 4 134 14 C146 20 146 54 134 60 C112 70 40 70 18 60 C6 54 6 20 18 14 Z"
        fill="#f3eede"
      />
      <path d="M118 20 C124 34 124 40 118 54" strokeWidth={3} stroke="#a9c6e6" />
      <path d="M108 22 C114 34 114 40 108 52" strokeWidth={3} stroke="#a9c6e6" />
    </g>
  </svg>
);

const Fridge = ({ className, style }: SvgProps) => (
  <svg viewBox="0 0 120 152" className={className} style={style} aria-hidden>
    <g {...strokeCommon}>
      <rect x="14" y="8" width="92" height="136" rx="14" fill="#8bb4df" />
      <rect x="22" y="16" width="16" height="120" rx="7" fill="#a6c8ea" stroke="none" />
      <path d="M14 56 H106" />
      <rect x="26" y="30" width="7" height="16" rx="3" fill="#5b86b3" />
      <rect x="26" y="66" width="7" height="34" rx="3" fill="#5b86b3" />
      <rect x="60" y="72" width="32" height="36" rx="4" fill="#fbf7ec" />
      <path d="M66 82 H86 M66 90 H86" strokeWidth={2.4} />
      <circle cx="76" cy="72" r="4" fill="#e0533f" />
      <Star5 cx={98} cy={64} size={13} fill="#f4c02c" />
      <rect x="24" y="144" width="12" height="7" rx="2" fill="#8bb4df" />
      <rect x="84" y="144" width="12" height="7" rx="2" fill="#8bb4df" />
    </g>
  </svg>
);

/** The full precarious stack, composed bottom-heavy like the reference. */
const TowerStack = () => (
  <div className="flex flex-col items-center">
    {/* Top cluster: box crowned by a lamp, with a plant + framed picture leaning in. */}
    <div className="relative h-[168px] w-[150px]" style={{ zIndex: 60 }}>
      <Plant
        className="absolute right-[6px] bottom-[54px] w-[52px]"
        style={{ transform: 'rotate(6deg)', zIndex: 1 }}
      />
      <Frame
        className="absolute -right-[10px] bottom-[66px] w-[62px]"
        style={{ transform: 'rotate(13deg)', zIndex: 2 }}
      />
      <Box
        className="absolute bottom-0 left-1/2 w-[122px]"
        style={{ transform: 'translateX(-50%) rotate(-2deg)', zIndex: 3 }}
      />
      <Lamp
        className="absolute left-[24px] bottom-[62px] w-[70px]"
        style={{ transform: 'rotate(-6deg)', zIndex: 4 }}
      />
    </div>

    <Book className="w-[142px]" style={{ marginTop: -10, transform: 'rotate(3deg)', zIndex: 50 }} />
    <Microwave
      className="w-[162px]"
      style={{ marginTop: -6, transform: 'rotate(-3deg)', zIndex: 40 }}
    />
    <Chair className="w-[126px]" style={{ marginTop: -8, transform: 'rotate(3deg)', zIndex: 30 }} />
    <Pillow
      className="w-[150px]"
      style={{ marginTop: -10, transform: 'rotate(-2deg)', zIndex: 20 }}
    />
    <Fridge className="w-[116px]" style={{ marginTop: -12, transform: 'rotate(1deg)', zIndex: 10 }} />
  </div>
);

const DownloadIcon = ({ className }: SvgProps) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke={INK}
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M12 3 v11 M7 10 l5 5 l5 -5" />
    <path d="M5 20 h14" />
  </svg>
);

/**
 * Scales the (fixed-size) tower illustration down so it always fits the space
 * between the header and the footer, never overflowing onto them. The content
 * is measured at its natural size (transforms don't affect offset*), so there
 * is no measure/scale feedback loop.
 */
function useFitScale() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    const recompute = () => {
      const vh = vp.clientHeight;
      const vw = vp.clientWidth;
      const ch = ct.offsetHeight;
      const cw = ct.offsetWidth;
      if (!ch || !cw) return;
      // 0.94 keeps a little breathing room around the stack.
      const next = Math.min(1, (vh / ch) * 0.94, (vw / cw) * 0.94);
      setScale(next > 0 ? next : 1);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(vp);
    ro.observe(ct);
    return () => ro.disconnect();
  }, []);

  return { viewportRef, contentRef, scale };
}

export const Splash = () => {
  const { viewportRef, contentRef, scale } = useFitScale();
  const [data, setData] = useState<SplashData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchBootstrap();
      if (cancelled || !('type' in res)) return;
      setData({
        username: res.username,
        finalized: res.tower.meta.status === 'finalized',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finalized = data?.finalized ?? false;
  // Real Reddit username; fall back to a plain greeting for logged-out/preview.
  const displayName = data?.username && data.username !== 'anonymous' ? data.username : '';
  const welcomeText = displayName ? `welcome ${displayName}!` : 'welcome!';

  // The splash lives in the Reddit feed; every action expands into the game.
  const openGame = (e: MouseEvent) => requestExpandedMode(e.nativeEvent, 'game');

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-between overflow-hidden bg-[#f6efdd] px-5 pt-3 pb-4 text-center"
      style={{ fontFamily: '"Baloo 2", "Nunito", system-ui, sans-serif' }}
    >
      {/* Header: centred logo with a tappable leaderboard trophy on the right.
          Laid out in-flow (grid) so every element paints reliably. */}
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-start">
        <div aria-hidden />
        <Logo />
        <div className="flex justify-end">
          <button
            onClick={openGame}
            aria-label="Leaderboard"
            className="cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95"
          >
            <Trophy className="h-11 w-11 drop-shadow-sm" />
          </button>
        </div>
      </div>

      {/* The illustrated tower — scaled to fit and clipped so it can never
          overlap the header or the footer. Twinkles sit behind it. */}
      <div ref={viewportRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
        <Sparkle className="absolute left-1 top-8 z-10" size={13} color="#4a90d9" />
        <Sparkle className="absolute right-3 top-16 z-10" size={16} color="#e8792e" />
        <Sparkle className="absolute left-4 top-1/3 z-10 opacity-90" size={11} color="#f4c02c" />
        <Sparkle className="absolute right-1 top-1/2 z-10" size={12} color="#4a90d9" />
        <Sparkle className="absolute left-2 bottom-20 z-10" size={14} color="#e8792e" />
        <Sparkle className="absolute right-4 bottom-10 z-10" size={12} color="#f4c02c" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div ref={contentRef} style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
            <TowerStack />
          </div>
        </div>
      </div>

      {/* Headline + live stats + primary action. */}
      <div className="relative flex w-full flex-col items-center gap-2">
        <h1 className="text-[26px] font-black leading-[1.08] tracking-tight text-[#2f2540]">
          One tower.
          <br />
          Everyone builds it.
        </h1>
        <div className="text-[13px] font-bold text-[#6f6580]">{welcomeText}</div>
        <button
          onClick={openGame}
          className="mt-1 flex w-full max-w-[330px] cursor-pointer items-center justify-center gap-3 rounded-2xl border-b-[5px] border-[#d09a12] bg-[#f4c02c] px-8 py-4 text-xl font-black tracking-wide text-[#2f2540] shadow-lg shadow-yellow-900/15 transition-all duration-150 hover:brightness-[1.03] active:translate-y-[3px] active:border-b-2"
        >
          {!finalized && <DownloadIcon />}
          {finalized ? 'ENTER' : 'ADD ONE THING'}
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
