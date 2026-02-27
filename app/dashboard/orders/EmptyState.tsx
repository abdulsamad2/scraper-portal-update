'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSpring, animated, useTrail, config } from '@react-spring/web';

/* ────────────────────────────────────────────────────────────
   SCENES
   ──────────────────────────────────────────────────────────── */
const SCENES = [
  {
    id: 'work',
    title: 'Genius at Work',
    subtitle: 'Shh! Deep focus mode activated. Orders handled automatically.',
    joke: '"Alt+Tab speed" is the only KPI that matters.',
    gradient: 'from-indigo-600 via-violet-500 to-purple-500',
    emoji: '🧑‍💻',
    bg: 'from-indigo-100/80 via-violet-50/50 to-purple-50/30',
    blob1: 'from-indigo-400/25 to-violet-400/25',
    blob2: 'from-purple-300/20 to-fuchsia-300/20',
    blob3: 'from-violet-200/15 to-indigo-200/15',
    dot: 'bg-indigo-500',
    tipColor: 'border-indigo-200/50 bg-indigo-50/40',
    ring: '#818CF8',
  },
  {
    id: 'coffee',
    title: 'Fuel Up, Champion',
    subtitle: 'No orders in sight. Perfect time for a coffee run.',
    joke: 'Decaf? In this economy? Never.',
    gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    emoji: '☕',
    bg: 'from-orange-100/70 via-amber-50/50 to-yellow-50/30',
    blob1: 'from-orange-400/25 to-amber-400/25',
    blob2: 'from-yellow-300/20 to-red-200/20',
    blob3: 'from-amber-200/15 to-orange-200/15',
    dot: 'bg-orange-500',
    tipColor: 'border-orange-200/50 bg-orange-50/40',
    ring: '#FB923C',
  },
  {
    id: 'zen',
    title: 'Zen Mode Activated',
    subtitle: 'Clear mind, clear queue. Nothing needs your attention right now.',
    joke: 'If only Monday mornings were this peaceful.',
    gradient: 'from-teal-500 via-emerald-500 to-green-500',
    emoji: '🧘',
    bg: 'from-teal-100/70 via-emerald-50/50 to-green-50/30',
    blob1: 'from-teal-400/25 to-emerald-400/25',
    blob2: 'from-green-300/20 to-cyan-200/20',
    blob3: 'from-emerald-200/15 to-teal-200/15',
    dot: 'bg-teal-500',
    tipColor: 'border-teal-200/50 bg-teal-50/40',
    ring: '#5EEAD4',
  },
  {
    id: 'trophy',
    title: 'Employee of the Month',
    subtitle: 'Every order confirmed. Every proof uploaded. Legend status.',
    joke: 'Your boss would clap... if they weren\'t in a meeting.',
    gradient: 'from-sky-500 via-blue-500 to-indigo-500',
    emoji: '🏆',
    bg: 'from-sky-100/70 via-blue-50/50 to-indigo-50/30',
    blob1: 'from-sky-400/25 to-blue-400/25',
    blob2: 'from-blue-300/20 to-indigo-200/20',
    blob3: 'from-indigo-200/15 to-sky-200/15',
    dot: 'bg-sky-500',
    tipColor: 'border-sky-200/50 bg-sky-50/40',
    ring: '#38BDF8',
  },
  {
    id: 'sleep',
    title: 'Power Save Mode',
    subtitle: 'Dashboard is quiet. Even the cat fell asleep.',
    joke: 'I\'m not slacking — I\'m conserving energy for the next rush.',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
    emoji: '😴',
    bg: 'from-rose-100/70 via-pink-50/50 to-fuchsia-50/30',
    blob1: 'from-rose-400/25 to-pink-400/25',
    blob2: 'from-fuchsia-300/20 to-rose-200/20',
    blob3: 'from-pink-200/15 to-rose-200/15',
    dot: 'bg-rose-500',
    tipColor: 'border-rose-200/50 bg-rose-50/40',
    ring: '#FDA4AF',
  },
];

const FUN_TIPS = [
  { text: 'Fastest finger gets the best seats. Be ready when the bell rings!', icon: '⚡' },
  { text: 'Tickets don\'t wait. Next time an order drops, grab it like the last slice of pizza.', icon: '🍕' },
  { text: 'Speed is everything. Confirm fast, deliver faster, coffee fastest.', icon: '🏎️' },
  { text: 'That order won\'t confirm itself. Stay sharp, stay caffeinated.', icon: '🎯' },
  { text: 'Bored? The Delivery Issues tab always has some drama. Go check it out.', icon: '🔥' },
  { text: 'Nothing pending? Confirmed orders might need proofs uploaded. Be a hero.', icon: '🦸' },
  { text: 'Psst... the Delivery Problems tab has orders crying for help right now.', icon: '🆘' },
  { text: 'Empty here doesn\'t mean empty everywhere. Other statuses need love too.', icon: '👀' },
  { text: '"I\'ll do it after lunch" — famous last words. Success rate: 27%.', icon: '🍔' },
  { text: 'Your order queue is cleaner than the office kitchen. And that\'s saying something.', icon: '🧹' },
  { text: 'Plot twist: No pending orders. The real order was the friends we made along the way.', icon: '🎬' },
  { text: 'This dashboard is so clean, Marie Kondo just shed a tear of joy.', icon: '✨' },
  { text: 'The average worker checks email 36 times per hour. You\'re checking orders. Much cooler.', icon: '📊' },
  { text: 'Zero orders pending. That\'s not luck — that\'s skill. Take a bow.', icon: '🎤' },
  { text: 'You cleared the entire board. The dashboard approves. We all approve.', icon: '👏' },
  { text: 'Empty queue = earned break. Company policy. (We just made that up, but still.)', icon: '📋' },
  { text: 'While you wait — confirmed orders have delivery deadlines that sneak up fast.', icon: '⏰' },
  { text: 'Upload proofs now, thank yourself later. Future you sends gratitude.', icon: '📸' },
  { text: 'The alert bell is locked and loaded. Go grab that coffee guilt-free.', icon: '🔔' },
  { text: 'Ahh, sweet silence. No alerts, no problems, no "URGENT" in the subject line.', icon: '🤫' },
];

const SEARCH_MESSAGES = [
  { title: 'Houston, No Results', subtitle: 'Your search came back empty. Try different keywords.', gradient: 'from-blue-500 to-indigo-500', emoji: '🔍' },
  { title: 'Nope, Nothing Here', subtitle: 'We looked everywhere. Even under the couch cushions.', gradient: 'from-purple-500 to-pink-500', emoji: '🤷' },
  { title: 'Ghost Town', subtitle: 'Maybe the orders are hiding? Try adjusting your filters.', gradient: 'from-orange-500 to-rose-500', emoji: '🕵️' },
];

/* ────────────────────────────────────────────────────────────
   TIME GREETING
   ──────────────────────────────────────────────────────────── */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good morning', icon: '🌅' };
  if (h < 17) return { text: 'Good afternoon', icon: '☀️' };
  if (h < 21) return { text: 'Good evening', icon: '🌇' };
  return { text: 'Night owl mode', icon: '🌙' };
}

/* ────────────────────────────────────────────────────────────
   ILLUSTRATIONS — richer, more detailed, with more spring life
   ──────────────────────────────────────────────────────────── */

function WorkIllustration({ clicked }: { clicked: number }) {
  const float = useSpring({ loop: true, from: { y: 0 }, to: [{ y: -6 }, { y: 0 }], config: { duration: 2000 } });
  const screen = useSpring({ loop: true, from: { opacity: 0.6 }, to: [{ opacity: 1 }, { opacity: 0.6 }], config: { duration: 1500 } });
  const typing = useTrail(3, { loop: true, from: { scale: 0.3 }, to: [{ scale: 1 }, { scale: 0.3 }], config: { duration: 800 } });
  const pop = useSpring({ scale: clicked > 0 ? 1.15 : 1, config: config.wobbly });
  const notif = useSpring({ loop: true, from: { y: 0, opacity: 0 }, to: [{ y: -15, opacity: 1 }, { y: -25, opacity: 0 }], config: { duration: 2500 } });

  return (
    <animated.svg viewBox="0 0 240 220" className="w-full h-full" style={{ transform: pop.scale.to(s => `scale(${s})`) }}>
      {/* Room background */}
      <rect x="10" y="10" width="220" height="180" rx="16" fill="#EEF2FF" opacity="0.5" />
      {/* Window */}
      <rect x="160" y="25" width="50" height="40" rx="4" fill="#BFDBFE" stroke="#93C5FD" strokeWidth="1.5" />
      <line x1="185" y1="25" x2="185" y2="65" stroke="#93C5FD" strokeWidth="1" />
      <line x1="160" y1="45" x2="210" y2="45" stroke="#93C5FD" strokeWidth="1" />
      {/* Plant */}
      <rect x="22" y="105" width="16" height="20" rx="3" fill="#A78BFA" />
      <circle cx="30" cy="98" r="10" fill="#34D399" />
      <circle cx="24" cy="102" r="7" fill="#6EE7B7" />
      <circle cx="36" cy="100" r="8" fill="#10B981" />
      {/* Desk */}
      <rect x="35" y="145" width="170" height="10" rx="5" fill="#C7D2FE" />
      <rect x="40" y="155" width="8" height="30" rx="2" fill="#A5B4FC" />
      <rect x="192" y="155" width="8" height="30" rx="2" fill="#A5B4FC" />
      {/* Laptop */}
      <animated.g style={{ transform: float.y.to(y => `translateY(${y}px)`) }}>
        <rect x="70" y="108" width="80" height="50" rx="5" fill="#4338CA" />
        <animated.rect x="76" y="113" width="68" height="37" rx="3" fill="#818CF8" style={{ opacity: screen.opacity }} />
        {/* Code lines on screen */}
        <rect x="82" y="118" width="30" height="3" rx="1.5" fill="#C7D2FE" opacity="0.7" />
        <rect x="82" y="124" width="45" height="3" rx="1.5" fill="#C7D2FE" opacity="0.5" />
        <rect x="82" y="130" width="20" height="3" rx="1.5" fill="#A5B4FC" opacity="0.6" />
        <rect x="82" y="136" width="38" height="3" rx="1.5" fill="#C7D2FE" opacity="0.4" />
        {/* Typing dots */}
        {typing.map((s, i) => (
          <animated.circle key={i} cx={88 + i * 14} cy={143} r="2.5" fill="#E0E7FF"
            style={{ transform: s.scale.to(sc => `scale(${sc})`), transformOrigin: `${88 + i * 14}px 143px` }} />
        ))}
        <rect x="65" y="158" width="90" height="5" rx="2.5" fill="#6366F1" />
      </animated.g>
      {/* Person */}
      <animated.g style={{ transform: float.y.to(y => `translateY(${y * 0.4}px)`) }}>
        <circle cx="110" cy="78" r="18" fill="#FBBF24" />
        <path d="M92 73 Q98 57 110 57 Q122 57 128 73" fill="#92400E" />
        <circle cx="103" cy="78" r="2.5" fill="#1E293B" />
        <circle cx="117" cy="78" r="2.5" fill="#1E293B" />
        {/* Glasses */}
        <circle cx="103" cy="78" r="5" fill="none" stroke="#475569" strokeWidth="1.2" />
        <circle cx="117" cy="78" r="5" fill="none" stroke="#475569" strokeWidth="1.2" />
        <line x1="108" y1="78" x2="112" y2="78" stroke="#475569" strokeWidth="1.2" />
        <path d="M103 86 Q110 91 117 86" stroke="#92400E" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <rect x="97" y="96" width="26" height="22" rx="5" fill="#6366F1" />
        <path d="M97 106 L75 128" stroke="#FBBF24" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M123 106 L145 128" stroke="#FBBF24" strokeWidth="4.5" strokeLinecap="round" />
      </animated.g>
      {/* Coffee mug */}
      <rect x="170" y="130" width="16" height="14" rx="3" fill="#F59E0B" />
      <path d="M186 133 Q193 137 186 141" stroke="#F59E0B" strokeWidth="2.5" fill="none" />
      <animated.path d="M175 124 Q177 118 179 124" stroke="#D1D5DB" strokeWidth="1.5" fill="none" style={{ opacity: screen.opacity }} />
      <animated.path d="M179 122 Q181 116 183 122" stroke="#D1D5DB" strokeWidth="1.5" fill="none" style={{ opacity: screen.opacity }} />
      {/* Notification popup */}
      <animated.g style={{ transform: notif.y.to(y => `translateY(${y}px)`), opacity: notif.opacity }}>
        <rect x="130" y="95" width="22" height="14" rx="4" fill="#EF4444" />
        <text x="141" y="105" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">0</text>
      </animated.g>
    </animated.svg>
  );
}

function CoffeeIllustration({ clicked }: { clicked: number }) {
  const steam1 = useSpring({ loop: true, from: { y: 0, opacity: 0.8 }, to: [{ y: -25, opacity: 0 }, { y: 0, opacity: 0.8 }], config: { duration: 2500 } });
  const steam2 = useSpring({ loop: true, from: { y: 0, opacity: 0.6 }, to: [{ y: -22, opacity: 0 }, { y: 0, opacity: 0.6 }], config: { duration: 3000 } });
  const steam3 = useSpring({ loop: true, from: { y: 0, opacity: 0.7 }, to: [{ y: -28, opacity: 0 }, { y: 0, opacity: 0.7 }], config: { duration: 2200 } });
  const cupFloat = useSpring({ loop: true, from: { y: 0 }, to: [{ y: -5 }, { y: 0 }], config: { duration: 3000 } });
  const hearts = useTrail(3, { loop: true, from: { y: 0, opacity: 0 }, to: [{ y: -35, opacity: 1 }, { y: -55, opacity: 0 }], config: { duration: 3500 } });
  const pop = useSpring({ scale: clicked > 0 ? 1.12 : 1, config: config.wobbly });
  const latte = useSpring({ loop: true, from: { rotate: -2 }, to: [{ rotate: 2 }, { rotate: -2 }], config: { duration: 4000 } });

  return (
    <animated.svg viewBox="0 0 240 220" className="w-full h-full" style={{ transform: pop.scale.to(s => `scale(${s})`) }}>
      {/* Table surface */}
      <ellipse cx="120" cy="185" rx="100" ry="15" fill="#D4A574" />
      <ellipse cx="120" cy="183" rx="95" ry="12" fill="#E8C9A0" />
      {/* Croissant */}
      <path d="M45 168 Q55 150 70 160 Q60 170 45 168 Z" fill="#F59E0B" />
      <path d="M47 167 Q55 155 65 162" stroke="#D97706" strokeWidth="1" fill="none" />
      {/* Saucer */}
      <ellipse cx="120" cy="172" rx="52" ry="10" fill="#B8860B" opacity="0.3" />
      <ellipse cx="120" cy="170" rx="48" ry="8" fill="#E8C9A0" />
      {/* Cup */}
      <animated.g style={{ transform: cupFloat.y.to(y => `translateY(${y}px)`) }}>
        <animated.g style={{ transform: latte.rotate.to(r => `rotate(${r}deg)`), transformOrigin: '120px 140px' }}>
          <path d="M78 108 L84 165 Q120 178 156 165 L162 108 Z" fill="#F97316" />
          {/* Cup gradient overlay */}
          <path d="M78 108 L84 165 Q120 178 156 165 L162 108 Z" fill="url(#cupGrad2)" />
          <ellipse cx="120" cy="108" rx="42" ry="12" fill="#FB923C" />
          {/* Latte art */}
          <ellipse cx="120" cy="114" rx="35" ry="8" fill="#92400E" />
          <path d="M108 114 Q120 108 132 114 Q120 120 108 114" fill="#D4A574" opacity="0.6" />
          <circle cx="120" cy="114" r="3" fill="#E8C9A0" opacity="0.5" />
          {/* Handle */}
          <path d="M162 118 Q185 124 185 140 Q185 156 162 152" stroke="#EA580C" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M162 122 Q180 127 180 140 Q180 153 162 148" stroke="#F97316" strokeWidth="3" fill="none" strokeLinecap="round" />
        </animated.g>
        {/* Steam */}
        <animated.path d="M100 93 Q97 80 102 70" stroke="#FDBA74" strokeWidth="2.5" fill="none" strokeLinecap="round"
          style={{ transform: steam1.y.to(y => `translateY(${y}px)`), opacity: steam1.opacity }} />
        <animated.path d="M120 90 Q123 74 118 65" stroke="#FED7AA" strokeWidth="3" fill="none" strokeLinecap="round"
          style={{ transform: steam2.y.to(y => `translateY(${y}px)`), opacity: steam2.opacity }} />
        <animated.path d="M140 93 Q143 78 138 70" stroke="#FDBA74" strokeWidth="2.5" fill="none" strokeLinecap="round"
          style={{ transform: steam3.y.to(y => `translateY(${y}px)`), opacity: steam3.opacity }} />
      </animated.g>
      {/* Hearts */}
      {hearts.map((s, i) => (
        <animated.text key={i} x={90 + i * 22} y={85} fontSize="16"
          style={{ transform: s.y.to(y => `translateY(${y}px)`), opacity: s.opacity }}>
          {['❤️', '🧡', '💛'][i]}
        </animated.text>
      ))}
      {/* Sugar cubes */}
      <rect x="175" y="162" width="10" height="10" rx="2" fill="white" stroke="#E5E7EB" strokeWidth="0.5" />
      <rect x="180" y="158" width="10" height="10" rx="2" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="0.5" />
      <defs>
        <linearGradient id="cupGrad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDBA74" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
        </linearGradient>
      </defs>
    </animated.svg>
  );
}

function ZenIllustration({ clicked }: { clicked: number }) {
  const breathe = useSpring({ loop: true, from: { scale: 1 }, to: [{ scale: 1.06 }, { scale: 1 }], config: { duration: 4000 } });
  const aura1 = useSpring({ loop: true, from: { scale: 0.9, opacity: 0.35 }, to: [{ scale: 1.25, opacity: 0 }, { scale: 0.9, opacity: 0.35 }], config: { duration: 3000 } });
  const aura2 = useSpring({ loop: true, from: { scale: 0.85, opacity: 0.25 }, to: [{ scale: 1.35, opacity: 0 }, { scale: 0.85, opacity: 0.25 }], config: { duration: 4500 } });
  const aura3 = useSpring({ loop: true, from: { scale: 0.8, opacity: 0.15 }, to: [{ scale: 1.45, opacity: 0 }, { scale: 0.8, opacity: 0.15 }], config: { duration: 5500 } });
  const sparkles = useTrail(6, { loop: true, from: { opacity: 0, scale: 0 }, to: [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0 }], config: { duration: 2500 } });
  const pop = useSpring({ scale: clicked > 0 ? 1.1 : 1, config: config.wobbly });
  const lotus = useSpring({ loop: true, from: { y: 0 }, to: [{ y: -3 }, { y: 0 }], config: { duration: 3000 } });

  return (
    <animated.svg viewBox="0 0 240 220" className="w-full h-full" style={{ transform: pop.scale.to(s => `scale(${s})`) }}>
      {/* Aura rings */}
      <animated.circle cx="120" cy="115" r="65" fill="none" stroke="#5EEAD4" strokeWidth="2"
        style={{ transform: aura1.scale.to(s => `scale(${s})`), opacity: aura1.opacity, transformOrigin: '120px 115px' }} />
      <animated.circle cx="120" cy="115" r="80" fill="none" stroke="#2DD4BF" strokeWidth="1.5"
        style={{ transform: aura2.scale.to(s => `scale(${s})`), opacity: aura2.opacity, transformOrigin: '120px 115px' }} />
      <animated.circle cx="120" cy="115" r="95" fill="none" stroke="#99F6E4" strokeWidth="1"
        style={{ transform: aura3.scale.to(s => `scale(${s})`), opacity: aura3.opacity, transformOrigin: '120px 115px' }} />
      {/* Lotus flower base */}
      <animated.g style={{ transform: lotus.y.to(y => `translateY(${y}px)`) }}>
        <ellipse cx="120" cy="170" rx="35" ry="8" fill="#14B8A6" opacity="0.2" />
        <path d="M100 168 Q110 155 120 168 Q130 155 140 168" fill="#5EEAD4" opacity="0.4" />
        <path d="M90 170 Q105 158 120 170 Q135 158 150 170" fill="#2DD4BF" opacity="0.3" />
      </animated.g>
      {/* Person meditating */}
      <animated.g style={{ transform: breathe.scale.to(s => `scale(${s})`), transformOrigin: '120px 130px' }}>
        {/* Head */}
        <circle cx="120" cy="80" r="20" fill="#FBBF24" />
        <path d="M100 74 Q108 58 120 58 Q132 58 140 74" fill="#92400E" />
        {/* Headband */}
        <path d="M100 72 Q120 68 140 72" stroke="#14B8A6" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Peaceful eyes */}
        <path d="M110 80 Q113 77 116 80" stroke="#1E293B" strokeWidth="1.8" fill="none" />
        <path d="M124 80 Q127 77 130 80" stroke="#1E293B" strokeWidth="1.8" fill="none" />
        {/* Smile */}
        <path d="M112 88 Q120 93 128 88" stroke="#92400E" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Body */}
        <path d="M100 100 Q120 96 140 100 L137 130 Q120 135 103 130 Z" fill="#14B8A6" />
        {/* Pattern on clothes */}
        <circle cx="120" cy="115" r="5" fill="none" stroke="#5EEAD4" strokeWidth="1" opacity="0.5" />
        {/* Legs crossed */}
        <path d="M95 130 Q108 148 120 138 Q132 148 145 130" fill="#0D9488" />
        {/* Arms */}
        <path d="M100 108 Q85 125 95 133" stroke="#FBBF24" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M140 108 Q155 125 145 133" stroke="#FBBF24" strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* Mudra glow */}
        <animated.circle cx="95" cy="134" r="5" fill="#5EEAD4" style={{ opacity: aura1.opacity }} />
        <animated.circle cx="145" cy="134" r="5" fill="#5EEAD4" style={{ opacity: aura1.opacity }} />
        <circle cx="95" cy="134" r="3.5" fill="#FDE68A" />
        <circle cx="145" cy="134" r="3.5" fill="#FDE68A" />
      </animated.g>
      {/* Sparkles */}
      {sparkles.map((s, i) => {
        const positions = [{ x: 60, y: 55 }, { x: 180, y: 60 }, { x: 45, y: 120 }, { x: 195, y: 115 }, { x: 120, y: 42 }, { x: 75, y: 160 }];
        const colors = ['#5EEAD4', '#2DD4BF', '#99F6E4', '#14B8A6', '#A7F3D0', '#6EE7B7'];
        const p = positions[i];
        return (
          <animated.g key={i} style={{ opacity: s.opacity, transform: s.scale.to(sc => `scale(${sc})`), transformOrigin: `${p.x}px ${p.y}px` }}>
            <line x1={p.x - 5} y1={p.y} x2={p.x + 5} y2={p.y} stroke={colors[i]} strokeWidth="2" strokeLinecap="round" />
            <line x1={p.x} y1={p.y - 5} x2={p.x} y2={p.y + 5} stroke={colors[i]} strokeWidth="2" strokeLinecap="round" />
          </animated.g>
        );
      })}
    </animated.svg>
  );
}

function TrophyIllustration({ clicked }: { clicked: number }) {
  const bounce = useSpring({ loop: true, from: { y: 0 }, to: [{ y: -8 }, { y: 0 }], config: { ...config.wobbly, duration: 1800 } });
  const shine = useSpring({ loop: true, from: { x: -40 }, to: { x: 280 }, config: { duration: 3500 } });
  const confetti = useTrail(10, { loop: true, from: { y: -20, opacity: 1 }, to: [{ y: 100, opacity: 0 }], config: { duration: 3500 } });
  const pop = useSpring({ scale: clicked > 0 ? 1.15 : 1, config: config.wobbly });
  const starGlow = useSpring({ loop: true, from: { scale: 1, opacity: 0.6 }, to: [{ scale: 1.3, opacity: 1 }, { scale: 1, opacity: 0.6 }], config: { duration: 2000 } });

  const confettiColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#F43F5E', '#6366F1', '#14B8A6', '#F97316'];
  const confettiShapes = ['rect', 'circle', 'rect', 'circle', 'rect', 'circle', 'rect', 'rect', 'circle', 'rect'];

  return (
    <animated.svg viewBox="0 0 240 220" className="w-full h-full" style={{ transform: pop.scale.to(s => `scale(${s})`) }}>
      {/* Confetti */}
      {confetti.map((s, i) => {
        const x = 25 + i * 20;
        return confettiShapes[i] === 'circle' ? (
          <animated.circle key={i} cx={x} cy={15} r="4" fill={confettiColors[i]}
            style={{ transform: s.y.to(y => `translateY(${y}px) rotate(${i * 36}deg)`), opacity: s.opacity, transformOrigin: `${x}px 15px` }} />
        ) : (
          <animated.rect key={i} x={x} y={12} width="7" height="7" rx="1.5" fill={confettiColors[i]}
            style={{ transform: s.y.to(y => `translateY(${y}px) rotate(${i * 36}deg)`), opacity: s.opacity, transformOrigin: `${x + 3.5}px 15.5px` }} />
        );
      })}
      {/* Podium */}
      <rect x="70" y="165" width="100" height="30" rx="6" fill="#3B82F6" />
      <rect x="70" y="165" width="100" height="8" rx="4" fill="#60A5FA" />
      <text x="120" y="186" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold" opacity="0.8">#1</text>
      {/* Trophy */}
      <animated.g style={{ transform: bounce.y.to(y => `translateY(${y}px)`) }}>
        {/* Cup body */}
        <path d="M78 68 L84 125 Q120 142 156 125 L162 68 Z" fill="#F59E0B" />
        <path d="M78 68 L84 125 Q120 142 156 125 L162 68 Z" fill="url(#trophyShine2)" />
        <ellipse cx="120" cy="68" rx="42" ry="12" fill="#FBBF24" />
        <ellipse cx="120" cy="68" rx="36" ry="8" fill="#FDE68A" opacity="0.3" />
        {/* Handles */}
        <path d="M78 80 Q48 86 48 102 Q48 118 78 115" stroke="#F59E0B" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M162 80 Q192 86 192 102 Q192 118 162 115" stroke="#F59E0B" strokeWidth="7" fill="none" strokeLinecap="round" />
        {/* Inner handle highlight */}
        <path d="M78 84 Q54 89 54 102 Q54 115 78 112" stroke="#FBBF24" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M162 84 Q186 89 186 102 Q186 115 162 112" stroke="#FBBF24" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Star with glow */}
        <animated.circle cx="120" cy="98" r="16" fill="#FDE68A" opacity="0.3"
          style={{ transform: starGlow.scale.to(s => `scale(${s})`), opacity: starGlow.opacity, transformOrigin: '120px 98px' }} />
        <polygon points="120,82 124,93 136,93 127,100 131,112 120,104 109,112 113,100 104,93 116,93" fill="#FEF3C7" />
        {/* Stem + base */}
        <rect x="110" y="138" width="20" height="10" rx="3" fill="#D97706" />
        <rect x="95" y="148" width="50" height="10" rx="4" fill="#B45309" />
        <rect x="95" y="148" width="50" height="4" rx="2" fill="#D97706" />
      </animated.g>
      {/* Shine sweep */}
      <animated.rect y="65" width="10" height="100" rx="5" fill="white" opacity="0.12"
        style={{ transform: shine.x.to(x => `translateX(${x}px) rotate(-20deg)`) }} />
      <defs>
        <linearGradient id="trophyShine2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#F59E0B" stopOpacity="0" />
          <stop offset="100%" stopColor="#FDE68A" stopOpacity="0.3" />
        </linearGradient>
      </defs>
    </animated.svg>
  );
}

function SleepIllustration({ clicked }: { clicked: number }) {
  const breathe = useSpring({ loop: true, from: { scale: 1 }, to: [{ scale: 1.02 }, { scale: 1 }], config: { duration: 3500 } });
  const zzz = useTrail(3, { loop: true, from: { y: 0, opacity: 0 }, to: [{ y: -45, opacity: 1 }, { y: -65, opacity: 0 }], config: { duration: 3500 } });
  const moonGlow = useSpring({ loop: true, from: { opacity: 0.5, scale: 1 }, to: [{ opacity: 1, scale: 1.05 }, { opacity: 0.5, scale: 1 }], config: { duration: 4000 } });
  const stars = useTrail(6, { loop: true, from: { opacity: 0.15, scale: 0.8 }, to: [{ opacity: 1, scale: 1.2 }, { opacity: 0.15, scale: 0.8 }], config: { duration: 2500 } });
  const pop = useSpring({ scale: clicked > 0 ? 1.1 : 1, config: config.wobbly });
  const blanketWave = useSpring({ loop: true, from: { y: 0 }, to: [{ y: 2 }, { y: 0 }], config: { duration: 4000 } });

  const starPositions = [{ x: 30, y: 20 }, { x: 55, y: 42 }, { x: 195, y: 35 }, { x: 170, y: 58 }, { x: 100, y: 18 }, { x: 210, y: 20 }];

  return (
    <animated.svg viewBox="0 0 240 220" className="w-full h-full" style={{ transform: pop.scale.to(s => `scale(${s})`) }}>
      {/* Night sky bg */}
      <rect x="10" y="5" width="220" height="100" rx="12" fill="#1E1B4B" opacity="0.08" />
      {/* Moon */}
      <animated.g style={{ opacity: moonGlow.opacity, transform: moonGlow.scale.to(s => `scale(${s})`), transformOrigin: '185px 35px' }}>
        <circle cx="185" cy="35" r="22" fill="#FDE68A" />
        <circle cx="193" cy="30" r="17" fill="white" opacity="0.15" />
        {/* Moon glow */}
        <circle cx="185" cy="35" r="28" fill="#FDE68A" opacity="0.15" />
      </animated.g>
      {/* Stars */}
      {stars.map((s, i) => (
        <animated.g key={i} style={{ opacity: s.opacity, transform: s.scale.to(sc => `scale(${sc})`), transformOrigin: `${starPositions[i].x}px ${starPositions[i].y}px` }}>
          <circle cx={starPositions[i].x} cy={starPositions[i].y} r="2.5" fill="#FBBF24" />
          <circle cx={starPositions[i].x} cy={starPositions[i].y} r="1" fill="#FEF3C7" />
        </animated.g>
      ))}
      {/* Bed frame */}
      <rect x="20" y="138" width="200" height="42" rx="10" fill="#F9A8D4" />
      <rect x="20" y="138" width="200" height="12" rx="6" fill="#F472B6" />
      {/* Headboard */}
      <rect x="15" y="105" width="16" height="75" rx="6" fill="#EC4899" />
      <rect x="15" y="105" width="16" height="75" rx="6" fill="url(#headboard)" />
      {/* Pillow */}
      <ellipse cx="65" cy="132" rx="30" ry="14" fill="white" />
      <ellipse cx="65" cy="130" rx="26" ry="10" fill="#FFF1F2" />
      {/* Pillow crease */}
      <path d="M50 130 Q65 126 80 130" stroke="#FECDD3" strokeWidth="0.8" fill="none" />
      {/* Person sleeping */}
      <animated.g style={{ transform: breathe.scale.to(s => `scale(${s})`), transformOrigin: '100px 130px' }}>
        <circle cx="70" cy="118" r="18" fill="#FBBF24" />
        <path d="M52 112 Q60 98 70 98 Q80 98 88 112" fill="#92400E" />
        {/* Closed eyes */}
        <path d="M62 119 L68 119" stroke="#1E293B" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M74 119 L80 119" stroke="#1E293B" strokeWidth="2.2" strokeLinecap="round" />
        {/* Blush */}
        <circle cx="60" cy="123" r="3" fill="#FCA5A5" opacity="0.4" />
        <circle cx="82" cy="123" r="3" fill="#FCA5A5" opacity="0.4" />
        {/* Smile */}
        <path d="M65 125 Q70 128 75 125" stroke="#92400E" strokeWidth="1.3" fill="none" />
        {/* Blanket */}
        <animated.g style={{ transform: blanketWave.y.to(y => `translateY(${y}px)`) }}>
          <path d="M82 125 Q130 115 205 135 L205 160 Q130 170 82 150 Z" fill="#EC4899" opacity="0.5" />
          <path d="M82 125 Q130 118 205 135 L205 142 Q130 128 82 138 Z" fill="#F472B6" opacity="0.35" />
          {/* Blanket pattern */}
          <circle cx="130" cy="140" r="4" fill="#F9A8D4" opacity="0.3" />
          <circle cx="160" cy="145" r="3" fill="#FBCFE8" opacity="0.3" />
          <circle cx="185" cy="142" r="3.5" fill="#F9A8D4" opacity="0.3" />
        </animated.g>
      </animated.g>
      {/* ZZZ — bigger, more spaced */}
      {zzz.map((s, i) => (
        <animated.text key={i} x={95 + i * 15} y={100} fontSize={14 + i * 5} fontWeight="bold" fill="#F9A8D4"
          style={{ transform: s.y.to(y => `translateY(${y + i * 6}px)`), opacity: s.opacity }}>
          Z
        </animated.text>
      ))}
      {/* Bed legs */}
      <rect x="28" y="180" width="8" height="15" rx="3" fill="#DB2777" />
      <rect x="204" y="180" width="8" height="15" rx="3" fill="#DB2777" />
      {/* Slippers */}
      <ellipse cx="195" cy="198" rx="10" ry="5" fill="#FBCFE8" />
      <ellipse cx="210" cy="198" rx="10" ry="5" fill="#FBCFE8" />
      <defs>
        <linearGradient id="headboard" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#BE185D" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#EC4899" stopOpacity="0" />
        </linearGradient>
      </defs>
    </animated.svg>
  );
}

const ILLUSTRATIONS: Record<string, React.FC<{ clicked: number }>> = {
  work: WorkIllustration,
  coffee: CoffeeIllustration,
  zen: ZenIllustration,
  trophy: TrophyIllustration,
  sleep: SleepIllustration,
};

/* ────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ──────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  search: string;
  hasStatusFilter: boolean;
  onClearSearch: () => void;
}

export default function EmptyState({ search, hasStatusFilter, onClearSearch }: EmptyStateProps) {
  const [sceneIndex, setSceneIndex] = useState(() => Math.floor(Math.random() * SCENES.length));
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * FUN_TIPS.length));
  const [visible, setVisible] = useState(true);
  const [clickCount, setClickCount] = useState(0);
  const [tipProgress, setTipProgress] = useState(0);
  const greeting = useMemo(() => getGreeting(), []);
  const sceneTimerRef = useRef(0);

  // Scene transition spring
  const fadeSpring = useSpring({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0px) scale(1)' : 'translateY(24px) scale(0.92)',
    config: { tension: 200, friction: 20 },
  });

  // Tip fade spring
  const [tipVisible, setTipVisible] = useState(true);
  const tipSpring = useSpring({
    opacity: tipVisible ? 1 : 0,
    transform: tipVisible ? 'translateY(0px)' : 'translateY(8px)',
    config: { duration: 250 },
  });

  // Entrance spring
  const entrance = useSpring({
    from: { opacity: 0, transform: 'translateY(40px) scale(0.9)' },
    to: { opacity: 1, transform: 'translateY(0px) scale(1)' },
    config: { tension: 120, friction: 14 },
  });

  // Auto-cycle scene every 30s
  useEffect(() => {
    if (search) return;
    const iv = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setSceneIndex(i => (i + 1) % SCENES.length);
        setVisible(true);
      }, 450);
    }, 30000);
    return () => clearInterval(iv);
  }, [search]);

  // Rotate tips every 25s with progress bar
  useEffect(() => {
    if (search) return;
    setTipProgress(0);
    const progressIv = setInterval(() => {
      setTipProgress(p => Math.min(p + 0.4, 100));
    }, 100);
    const iv = setInterval(() => {
      setTipVisible(false);
      setTipProgress(0);
      setTimeout(() => {
        setTipIndex(i => (i + 1) % FUN_TIPS.length);
        setTipVisible(true);
      }, 280);
    }, 25000);
    return () => { clearInterval(iv); clearInterval(progressIv); };
  }, [search]);

  // Scene progress for dots
  useEffect(() => {
    if (search) return;
    sceneTimerRef.current = 0;
    const iv = setInterval(() => { sceneTimerRef.current += 1; }, 100);
    return () => clearInterval(iv);
  }, [search, sceneIndex]);

  const scene = SCENES[sceneIndex];
  const searchMsg = SEARCH_MESSAGES[sceneIndex % SEARCH_MESSAGES.length];
  const tip = FUN_TIPS[tipIndex];
  const Illustration = useMemo(() => ILLUSTRATIONS[scene.id], [scene.id]);

  const handleIllustrationClick = useCallback(() => {
    setClickCount(c => c + 1);
  }, []);

  const switchScene = useCallback((i: number) => {
    setVisible(false);
    setTimeout(() => { setSceneIndex(i); setVisible(true); }, 400);
  }, []);

  return (
    <animated.div style={entrance}
      className={`relative min-h-[calc(100vh-220px)] rounded-2xl border border-gray-200/60 overflow-hidden transition-all duration-700 bg-gradient-to-br ${scene.bg}`}>

      {/* Background blobs */}
      <div className={`absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-br ${scene.blob1} rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3 transition-all duration-1000`} />
      <div className={`absolute bottom-0 right-0 w-[600px] h-[600px] bg-gradient-to-br ${scene.blob2} rounded-full blur-3xl translate-x-1/4 translate-y-1/4 transition-all duration-1000`} />
      <div className={`absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-gradient-to-br ${scene.blob3} rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 transition-all duration-1000`} />
      <div className="absolute top-16 right-24 w-28 h-28 bg-gradient-to-br from-yellow-200/12 to-amber-200/12 rounded-full blur-2xl" />
      <div className="absolute bottom-24 left-20 w-36 h-36 bg-gradient-to-br from-sky-200/12 to-cyan-200/12 rounded-full blur-2xl" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[
          { color: 'bg-blue-400', size: 'w-2.5 h-2.5', left: '8%', delay: '0s', dur: '8s' },
          { color: 'bg-purple-400', size: 'w-2 h-2', left: '20%', delay: '2s', dur: '10s' },
          { color: 'bg-pink-400', size: 'w-2.5 h-2.5', left: '35%', delay: '4s', dur: '7s' },
          { color: 'bg-amber-400', size: 'w-2 h-2', left: '48%', delay: '1s', dur: '9s' },
          { color: 'bg-emerald-400', size: 'w-2.5 h-2.5', left: '62%', delay: '3s', dur: '11s' },
          { color: 'bg-cyan-400', size: 'w-1.5 h-1.5', left: '75%', delay: '5s', dur: '8s' },
          { color: 'bg-rose-400', size: 'w-2 h-2', left: '88%', delay: '6s', dur: '12s' },
          { color: 'bg-indigo-400', size: 'w-1.5 h-1.5', left: '52%', delay: '7s', dur: '9s' },
          { color: 'bg-violet-400', size: 'w-2 h-2', left: '15%', delay: '3.5s', dur: '13s' },
          { color: 'bg-teal-400', size: 'w-1.5 h-1.5', left: '42%', delay: '8s', dur: '10s' },
          { color: 'bg-orange-400', size: 'w-2 h-2', left: '95%', delay: '1.5s', dur: '11s' },
          { color: 'bg-fuchsia-400', size: 'w-1.5 h-1.5', left: '5%', delay: '9s', dur: '14s' },
        ].map((p, i) => (
          <div key={i} className={`absolute ${p.color} ${p.size} rounded-full opacity-20`}
            style={{ left: p.left, animation: `particle-float ${p.dur} ease-in-out infinite`, animationDelay: p.delay }} />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-220px)] px-8 py-8">

        {/* Time-of-day greeting badge */}
        <div className="mb-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/50 backdrop-blur-sm border border-white/60 shadow-sm">
            <span className="text-sm">{greeting.icon}</span>
            <span className="text-xs font-medium text-gray-500">{greeting.text}</span>
            <span className="text-gray-300 mx-0.5">|</span>
            <span className="text-xs text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        {/* Illustration — clickable with bounce */}
        <animated.div style={fadeSpring}
          className="w-[300px] h-[280px] mb-4 cursor-pointer select-none"
          onClick={handleIllustrationClick}
          title="Click me!">
          <Illustration clicked={clickCount} />
        </animated.div>

        {/* Text */}
        <animated.div style={fadeSpring} className="flex flex-col items-center">
          <div className="flex items-center gap-3 mb-2.5">
            <span className="text-4xl drop-shadow-sm">{search ? searchMsg.emoji : scene.emoji}</span>
            <h3 className={`text-3xl font-extrabold bg-gradient-to-r ${search ? searchMsg.gradient : scene.gradient} bg-clip-text text-transparent leading-tight`}>
              {search ? searchMsg.title : scene.title}
            </h3>
          </div>
          <p className="text-[15px] text-gray-600 max-w-lg text-center leading-relaxed">
            {search ? `No results for "${search}"` : scene.subtitle}
          </p>
          {!search && (
            <p className="text-sm text-gray-400 italic mt-1.5 max-w-md text-center">
              {scene.joke}
            </p>
          )}
        </animated.div>

        {/* Scene dots with progress ring */}
        <div className="flex items-center justify-center gap-3 mt-5 mb-5">
          {SCENES.map((s, i) => (
            <button key={i} onClick={() => switchScene(i)}
              className={`relative rounded-full transition-all duration-300 ${
                i === sceneIndex
                  ? `w-9 h-3 ${s.dot} shadow-lg`
                  : 'w-3 h-3 bg-gray-300/40 hover:bg-gray-400/60 hover:scale-110'
              }`}>
              {i === sceneIndex && (
                <span className="absolute inset-0 rounded-full animate-pulse opacity-30" style={{ backgroundColor: s.ring }} />
              )}
            </button>
          ))}
        </div>

        {/* Rotating tip with progress bar */}
        {!search && (
          <animated.div style={tipSpring}
            className={`relative px-6 py-3.5 rounded-xl backdrop-blur-sm border max-w-lg mx-auto overflow-hidden transition-colors duration-700 ${scene.tipColor}`}>
            {/* Progress bar */}
            <div className="absolute bottom-0 left-0 h-[2px] transition-all duration-100 rounded-full"
              style={{ width: `${tipProgress}%`, backgroundColor: scene.ring, opacity: 0.5 }} />
            <p className="text-[13px] text-gray-500 text-center leading-relaxed">
              <span className="mr-2 text-base">{tip.icon}</span>{tip.text}
            </p>
          </animated.div>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-center gap-4 mt-5">
          {search ? (
            <button onClick={onClearSearch}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white text-sm font-bold transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:-translate-y-0.5">
              Clear search
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-white/60 backdrop-blur-sm border border-white/80 shadow-sm">
                <div className="relative">
                  <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                  <div className="absolute inset-0 w-2.5 h-2.5 bg-green-400 rounded-full animate-ping opacity-40" />
                </div>
                <span className="text-sm font-medium text-gray-500">Alert system active</span>
              </div>
              {hasStatusFilter && (
                <span className="text-xs text-gray-400 bg-white/40 px-3 py-1.5 rounded-lg border border-gray-200/40">Try a different status</span>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes particle-float {
          0%, 100% { transform: translateY(100%) rotate(0deg); opacity: 0; }
          10% { opacity: 0.2; }
          50% { opacity: 0.1; }
          90% { opacity: 0.2; }
          100% { transform: translateY(-100%) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </animated.div>
  );
}
