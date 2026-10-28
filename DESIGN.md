---
version: "alpha"
name: "Architectural Schematic"
description: "Architectural landing page, schematic design, floor plan style, technical drawing, clean lines, dimension markers, white background. Ideal for landing pages, modern websites. AI-ready template."
colors:
  primary: "#F9F9F9"
  secondary: "#222222"
  tertiary: "#5B9BD5"
  neutral: "#4A90E2"
  surface: "#808080"
  accent: "#FCFCFC"
typography:
  h1:
    fontFamily: Helvetica Neue
    fontSize: 2.5rem
    fontWeight: 700
  body-md:
    fontFamily: Helvetica Neue
    fontSize: 1rem
    fontWeight: 400
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    padding: 12px
---

## Overview

Architectural landing page, schematic design, floor plan style, technical drawing, clean lines, dimension markers, white background. Ideal for landing pages, modern websites. AI-ready template. Architectural drawings predate digital anything. Orthographic projection, section cuts, elevation views — these conventions crystallized over centuries because they solve a brutal problem: how do you communicate three-dimensional intent on a flat surface without ambiguity? The answer was a shared visual grammar. Precise line weights. Dashed lines for hidden geometry. Hatching for material cuts. When CAD arrived in the 1980s, it didn't reinvent this language — it digitized it wholesale.

What's interesting is how that technical vocabulary leaked into broader design culture. Floor plans started appearing in editorial layouts, brand identities, UI backgrounds. Not because anyone needed to build from them, but because they carry an instant connotation: rigor, spatial intelligence, systematic thinking. The blueprint aesthetic became shorthand for "we think in systems."

The futuristic layer came later. Neon strokes on dark grounds. Animated section lines. Isometric explosions that no architect would actually draft. It's the language of precision, remixed for screens — less about construction documents, more about communicating that you operate at the intersection of technology and physical space.

- Density: 3/10 — Airy
- Variance: 2/10 — Structured
- Motion: 4/10 — Subtle

- **Style:** Analytical, Precise, Clean
- **Keywords:** architectural, schematic, floor plan, lines, precise, minimal, structured, dimension markers
- **Era:** Modern Architecture
- **Light/Dark:** ✓ Full / ✗ No

## Colors

- **Background** (#F9F9F9) — Primary background surface
- **Text** (#222222) — Primary text color
- **Accent** (#5B9BD5) — Primary accent, CTAs and interactive elements
- **Drafting Blue** (#4A90E2) — Secondary accent
- **Pencil Grey** (#808080) — Secondary text, borders, muted elements
- **Paper White** (#FCFCFC) — Secondary surface


## Typography

- **Display / Hero:** Helvetica Neue — Weight 700, tight tracking, used for headline impact
- **Body:** Helvetica Neue — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Helvetica Neue — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values

Scale:
- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem


## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).
- **Hero layout:** Split-screen (text left, visual right).
- **Feature sections:** Zig-zag alternating text+image rows. No 3-equal-columns.
- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.
- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).


## Elevation & Depth

Technical line art, dimension markers, architectural symbols, 1px-2px strokes, dashed logic flows.

- **Physics:** Ease-out curves, 200-300ms duration. Smooth and predictable.
- **Entry animations:** Fade + translate-Y (16px → 0) over 420ms ease-out. Staggered cascades for lists: 80ms between items.
- **Hover states:** Subtle color shift + shadow adjustment over 200ms.
- **Page transitions:** Fade only (200ms).
- **Performance:** Only transform and opacity animated. No layout-triggering properties.


## Shapes

Base corner radius: 8px. See rounded tokens in front matter for the full scale.


## Components

- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.
- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.
- **Cards:** Subtly rounded (0.5rem) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.
- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.
- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.
- **Empty States:** Icon-based composition with descriptive text and action button.


## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)
- No decorative gradients — flat color only
- No shadows heavier than 0 2px 8px rgba(0,0,0,0.08)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%)
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos

- Do Clean white/paper background
- Do Fine lines (1px) for structure
- Do Architectural symbols/markers
- Do Serif or Clean Sans typography
- Do Asymmetric/Grid layout


## Use Case

Landing pages, Modern websites
