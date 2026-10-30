import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const C = {
  bg: '#f5f2e9', fg: '#17372e', primary: '#1c4c3d', card: '#fffdf7',
  accent: '#e66d51', secondary: '#e8ebe2', muted: '#718078', border: '#dce4da',
};
const ICON = `${import.meta.env.BASE_URL}icon.png`;
const spring = { type: 'spring' as const, stiffness: 260, damping: 22 };

function usePhase(times: number[]) {
  const [p, setP] = useState(0);
  const events = useMemo(() => times.map((t, i) => ({ time: t, callback: () => setP(i + 1) })), [times.join(',')]);
  useSceneTimer(events);
  return p;
}

const Full = ({ children, bg, style }: { children: React.ReactNode; bg: string; style?: React.CSSProperties }) => (
  <motion.div className="absolute inset-0 overflow-hidden" style={{ background: bg, ...style }}
    initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
    transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
    {children}
  </motion.div>
);

const Eyebrow = ({ children, color = C.muted }: { children: React.ReactNode; color?: string }) => (
  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2vmin', letterSpacing: '0.2em', color, display: 'flex', alignItems: 'center', gap: '1.2vmin' }}>
    <span style={{ width: '1.4vmin', height: '1.4vmin', borderRadius: 99, background: C.accent }} />{children}
  </div>
);

function Card({ eyebrow, text, topic = 'Cell biology', w = 46, answer = false }: { eyebrow: string; text: string; topic?: string; w?: number; answer?: boolean }) {
  return (
    <div style={{ width: `${w}vmin`, height: `${w * 0.78}vmin`, background: C.card, borderRadius: '4vmin', border: `0.25vmin solid ${C.border}`, padding: '4vmin', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 3vmin 6vmin -2vmin rgba(23,55,46,0.28)' }}>
      <div style={{ alignSelf: 'flex-start', background: C.secondary, color: C.primary, borderRadius: 99, padding: '0.8vmin 2vmin', fontSize: '2vmin', fontWeight: 600 }}>{topic}</div>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', color: C.accent, fontSize: '1.9vmin', letterSpacing: '0.18em', marginBottom: '1.4vmin' }}>{eyebrow}</div>
        <div style={{ fontFamily: answer ? 'var(--font-body)' : 'var(--font-display)', fontSize: answer ? '3.1vmin' : '4.4vmin', lineHeight: 1.12, color: C.fg, fontWeight: answer ? 500 : 400 }}>{text}</div>
      </div>
    </div>
  );
}

/* 1. HOOK: flashcards pop, title */
export function HookScene() {
  const p = usePhase([350, 800, 1250, 1800]);
  const words = ['Make', 'learning', 'stick.'];
  return (
    <Full bg={C.bg}>
      {[{ r: -14, x: -34, y: -16, c: C.accent }, { r: 9, x: 32, y: 18, c: C.primary }, { r: -5, x: 30, y: -26, c: '#e7efe6' }].map((s, i) => (
        <motion.div key={i} className="absolute" style={{ left: '50%', top: '50%', width: '22vmin', height: '28vmin', marginLeft: '-11vmin', marginTop: '-14vmin', background: s.c, borderRadius: '3vmin' }}
          initial={{ scale: 0, rotate: 0, x: 0, y: 0 }}
          animate={p > i ? { scale: 1, rotate: s.r, x: `${s.x}vw`, y: `${s.y}vh` } : { scale: 0.4, rotate: 0, x: 0, y: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 18 }} />
      ))}
      <div className="absolute inset-0 flex items-center justify-center" style={{ gap: '3vmin' }}>
        {words.map((w, i) => (
          <div key={w} style={{ overflow: 'hidden', padding: '1vmin 0.5vmin' }}>
            <motion.div style={{ fontFamily: 'var(--font-display)', fontSize: '15vmin', lineHeight: 1, color: i === 2 ? C.accent : C.fg, fontStyle: i === 2 ? 'italic' : 'normal' }}
              initial={{ y: '110%' }} animate={{ y: p >= i + 1 ? '0%' : '110%' }} transition={spring}>{w}</motion.div>
          </div>
        ))}
      </div>
      <motion.div className="absolute" style={{ bottom: '9vh', left: 0, right: 0, display: 'flex', justifyContent: 'center' }}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: p >= 4 ? 1 : 0, y: p >= 4 ? 0 : 20 }}>
        <Eyebrow>SKILLSWIPE — FLASHCARDS FOR ANY TOPIC</Eyebrow>
      </motion.div>
    </Full>
  );
}

/* 2. AI generation: type topic, generate, cards fan out */
export function GenerateScene() {
  const topic = 'Biology basics';
  const typeTimes = useMemo(() => topic.split('').map((_, i) => 300 + i * 55), []);
  const t = usePhase([...typeTimes, 1350, 1800, 2400, 2700, 3000]);
  const n = typeTimes.length;
  const typed = topic.slice(0, Math.min(t, n));
  const pressed = t >= n + 1, creating = t >= n + 2, fan = t - (n + 2);
  const qs = ['What is the powerhouse of the cell?', 'What does a cell membrane do?', 'What is DNA’s primary role?'];
  return (
    <Full bg={C.primary}>
      <div className="absolute" style={{ left: '7vw', top: '12vh' }}>
        <Eyebrow color="#cae18d">01 — AI GENERATION</Eyebrow>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '9.5vmin', lineHeight: 1, color: C.card, marginTop: '2vmin' }}>Any topic.<br /><span style={{ color: C.accent, fontStyle: 'italic' }}>Instant deck.</span></div>
        <motion.div style={{ marginTop: '6vmin', display: 'flex', gap: '1.6vmin', alignItems: 'center' }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, ...spring }}>
          <div style={{ width: '40vmin', background: C.card, borderRadius: '2.4vmin', padding: '2.2vmin 2.6vmin', fontSize: '3.2vmin', color: C.fg, fontWeight: 500 }}>
            {typed}<motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} style={{ color: C.accent }}>|</motion.span>
          </div>
          <motion.div animate={{ scale: pressed && !creating ? 0.9 : 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            style={{ background: C.accent, color: '#fffaf5', borderRadius: '2.4vmin', padding: '2.2vmin 3vmin', fontSize: '3vmin', fontWeight: 700 }}>
            {creating ? 'Creating…' : '✦ Generate'}
          </motion.div>
        </motion.div>
      </div>
      {qs.map((q, i) => (
        <motion.div key={q} className="absolute" style={{ right: '8vw', top: '22vh' }}
          initial={{ opacity: 0, scale: 0.5, x: '-30vw', rotate: 0 }}
          animate={fan > i ? { opacity: 1, scale: 1, x: `${-i * 4}vw`, y: `${i * 6}vh`, rotate: [-8, 4, -3][i] } : { opacity: 0, scale: 0.5, x: '-30vw', rotate: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 20 }}>
          <Card eyebrow="QUESTION" text={q} w={42} />
        </motion.div>
      ))}
    </Full>
  );
}

/* 3. Tap to reveal: flip */
export function RevealScene() {
  const p = usePhase([900, 1300, 2600]);
  const flipped = p >= 2;
  return (
    <Full bg={C.bg}>
      <div className="absolute" style={{ right: '7vw', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <Eyebrow>02 — TAP TO REVEAL</Eyebrow>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '10vmin', lineHeight: 1, color: C.fg, marginTop: '2vmin' }}>Think first.<br /><motion.span style={{ color: C.accent, fontStyle: 'italic', display: 'inline-block' }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: flipped ? 1 : 0, y: flipped ? 0 : 30 }} transition={spring}>Then tap.</motion.span></div>
      </div>
      <div className="absolute" style={{ left: '10vw', top: '50%', marginTop: '-30vmin', perspective: 1600 }}>
        <div className="absolute" style={{ inset: 0, background: C.primary, borderRadius: '4vmin', transform: 'rotate(4deg)' }} />
        <motion.div style={{ position: 'relative', transformStyle: 'preserve-3d' }} initial={{ rotateY: 0, scale: 0.9 }} animate={{ rotateY: flipped ? 180 : 0, scale: p >= 3 ? 1.03 : 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
          <div style={{ backfaceVisibility: 'hidden' }}><Card eyebrow="QUESTION" text="What is the powerhouse of the cell?" w={64} /></div>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}><Card answer eyebrow="THE ANSWER" text="The mitochondrion. It converts energy from food into ATP, the form of energy cells can use." w={64} /></div>
        </motion.div>
        <motion.div className="absolute" style={{ left: '38vmin', top: '30vmin', width: '9vmin', height: '9vmin', borderRadius: 99, background: 'rgba(230,109,81,0.35)', border: `0.5vmin solid ${C.accent}` }}
          initial={{ opacity: 0, scale: 1.6 }} animate={p >= 1 ? { opacity: [0, 1, 0], scale: [1.6, 0.8, 2.2] } : {}} transition={{ duration: 0.8 }} />
      </div>
    </Full>
  );
}

/* 4. Swipe to study */
export function SwipeScene() {
  const p = usePhase([500, 1300, 2100, 2900]);
  const cards = [
    { q: 'What does a cell membrane do?', topic: 'Cell biology', dir: 1 },
    { q: 'What is DNA’s primary role?', topic: 'Genetics', dir: -1 },
    { q: 'How do enzymes speed up reactions?', topic: 'Chemistry of life', dir: 1 },
  ];
  const done = Math.min(p, 3);
  return (
    <Full bg="#e7efe6">
      <div className="absolute" style={{ left: 0, right: 0, top: '7vh', textAlign: 'center' }}>
        <div style={{ display: 'inline-block' }}><Eyebrow>03 — SWIPE TO STUDY</Eyebrow></div>
      </div>
      <div className="absolute" style={{ left: '6vw', top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--font-display)', fontSize: '9vmin', color: C.accent, fontStyle: 'italic' }}>
        <motion.div animate={{ opacity: p === 2 ? 1 : 0.25, x: p === 2 ? 0 : 20 }}>← Again</motion.div>
      </div>
      <div className="absolute" style={{ right: '6vw', top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--font-display)', fontSize: '9vmin', color: C.primary }}>
        <motion.div animate={{ opacity: p === 1 || p === 3 ? 1 : 0.25, x: p === 1 || p === 3 ? 0 : -20 }}>Know it →</motion.div>
      </div>
      {cards.map((c, i) => (
        <motion.div key={c.q} className="absolute" style={{ left: '50%', top: '52%', marginLeft: '-25vmin', marginTop: '-19.5vmin', zIndex: 10 - i }}
          initial={{ x: 0, rotate: 0, scale: 1 - i * 0.05, y: i * 20 }}
          animate={done > i ? { x: `${c.dir * 70}vw`, rotate: c.dir * 18, scale: 1, y: 0 } : { x: 0, rotate: 0, scale: 1 - (i - done) * 0.05, y: (i - done) * 20 }}
          transition={{ type: 'spring', stiffness: 160, damping: 22 }}>
          <Card eyebrow="QUESTION" text={c.q} topic={c.topic} w={50} />
        </motion.div>
      ))}
      <div className="absolute" style={{ left: '30vw', right: '30vw', bottom: '9vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '2.2vmin', color: C.fg, fontWeight: 600, marginBottom: '1vmin' }}>
          <span>Card {String(done + 2).padStart(2, '0')}</span><span style={{ color: C.muted }}>{done + 1} of 6 done</span>
        </div>
        <div style={{ height: '1.2vmin', background: C.border, borderRadius: 99, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', background: C.accent, borderRadius: 99, transformOrigin: 'left', width: '100%' }} initial={{ scaleX: 1 / 6 }} animate={{ scaleX: (done + 1) / 6 }} transition={spring} />
        </div>
      </div>
    </Full>
  );
}

/* 5. Backgrounds */
const BGS = [
  { l: 'Default', c: '#f5f2e9' }, { l: 'Soft sage', c: '#e7efe6' }, { l: 'Misty blue', c: '#e8eff5' },
  { l: 'Muted rose', c: '#f5e9e5' }, { l: 'Lavender', c: '#eeeaf5' },
];
export function BackgroundScene() {
  const p = usePhase([300, 900, 1500, 2100, 2700]);
  const cur = BGS[Math.max(0, p - 1)];
  return (
    <Full bg={C.bg}>
      <motion.div className="absolute inset-0" animate={{ backgroundColor: cur.c }} transition={{ duration: 0.35 }} />
      <div className="absolute" style={{ left: '7vw', top: '14vh' }}>
        <Eyebrow>04 — MAKE IT YOURS</Eyebrow>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '10vmin', lineHeight: 1, color: C.fg, marginTop: '2vmin' }}>Study in<br />your color.</div>
        <div style={{ position: 'relative', height: '8vmin', marginTop: '3vmin', overflow: 'hidden' }}>
          <motion.div key={cur.l} initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}
            style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '6.5vmin', color: C.accent }}>{cur.l}</motion.div>
        </div>
      </div>
      <div className="absolute" style={{ right: '8vw', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '2vmin' }}>
        {BGS.map((b, i) => (
          <motion.div key={b.l} initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1, scale: p - 1 === i ? 1.08 : 1 }} transition={{ delay: i * 0.06, ...spring }}
            style={{ display: 'flex', alignItems: 'center', gap: '2vmin', background: C.card, borderRadius: '2.6vmin', padding: '1.6vmin 3vmin 1.6vmin 1.6vmin', width: '40vmin', border: `0.35vmin solid ${p - 1 === i ? C.primary : C.border}` }}>
            <div style={{ width: '6vmin', height: '6vmin', borderRadius: 99, background: b.c, border: `0.25vmin solid ${C.border}` }} />
            <span style={{ fontSize: '2.8vmin', fontWeight: 600, color: C.fg }}>{b.l}</span>
          </motion.div>
        ))}
      </div>
    </Full>
  );
}

/* 6. Lockup */
export function OutroScene() {
  const p = usePhase([250, 650, 1100]);
  return (
    <Full bg={C.primary}>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: '3vmin' }}>
        <motion.img src={ICON} style={{ width: '22vmin', height: '22vmin', borderRadius: '5vmin' }} initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }} />
        <motion.div style={{ fontFamily: 'var(--font-display)', fontSize: '13vmin', lineHeight: 1, color: C.card }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: p >= 1 ? 1 : 0, y: p >= 1 ? 0 : 30 }} transition={spring}>skillswipe</motion.div>
        <motion.div style={{ fontSize: '3.4vmin', color: '#cae18d', fontWeight: 500 }} initial={{ opacity: 0 }} animate={{ opacity: p >= 2 ? 1 : 0 }}>Generate. Reveal. Swipe. <span style={{ color: C.accent }}>Make learning stick.</span></motion.div>
      </div>
    </Full>
  );
}
