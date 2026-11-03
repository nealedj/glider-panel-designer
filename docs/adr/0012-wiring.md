# 0012. Wiring and pneumatics: nets, sizing from AC 43.13-1B, lengths, schematic

- Status: accepted; guide points, route editing and bus bars added by 0017
- Date: 2026-10-11

## Context

M6 adds wiring and pneumatics on the existing model. Parts carry connectors with pins, and
ports. The project has nets, wires (tubes are wires with a bore) and routes. The brief asks
for:

- wire sizing in mm² from published aviation charts, with their source recorded;
- protection chosen to protect the wire;
- voltage-drop and load checks;
- lengths from routes;
- bundles counted in clash checks;
- an automatic schematic that reads without hand tidying.

## Decision

- **Nets are derived from wires.** After every wiring edit, nets are recomputed as connected
  components over wires and tube tees. A tee's `any` ports are one pressure space. Each net
  keeps its id, name and protection where it survives a split or merge: the largest piece
  keeps the name. Net type comes from its terminals (power, ground, data, audio, RF, switch,
  pitot, static or TE).
- **Charts as data, with source and snippet** (`wiring/charts.ts`), read from the FAA's PDF of
  AC 43.13-1B CHG 1:
  - **Table 11-9:** current in bundles at 105, 150 and 200 °C, and maximum resistance per
    1,000 ft;
  - **Table 11-3:** the largest breaker or fuse per wire size;
  - **Table 11-6:** allowable voltage drop, 0.5 V continuous for a 14 V system.

  The tables are in AWG. Sizes are shown in mm² with the AWG alongside. A metric size is
  rated as the largest chart size not bigger than it, for both current and resistance, so it
  is never rated above the chart.
- **Circuit analysis** (`wiring/circuit.ts`):
  - **Tracing:** the analysis traces breadth-first from each battery's + terminal along wires,
    through switches (taken as closed) and fuses or breakers, to every powered part's supply
    pin. The return runs from its ground pin to the battery's − terminal.
  - **Current:** each wire's current is the sum of the loads whose paths use it.
  - **Automatic sizing:** the smallest chart size, no smaller than the minimum (AWG 22 by
    default), that:
    - carries the current;
    - keeps the wire's share of the drop limit (limit × wire length ÷ the longest battery → load
      → battery loop through it);
    - is protected by the nearest fuse or breaker upstream, per table 11-3. A return wire takes
      the largest feed protection of the loads it carries.
  - **Checks:** the brief's electrical table, plus two more: wires running from the battery
    with no protection (except a battery-to-main-fuse link beyond the panel), and RX pins
    joined with no TX.
- **Lengths** (`wiring/length.ts`):
  - **On a route:** each end goes straight in 3D to the route's nearest point, then the wire
    follows the route between those points.
  - **No route:** a straight 3D line, flagged as an estimate.
  - **Off-panel ends:** the part's own "run beyond the exit" is added. Two off-panel parts at
    the same exit are joined beyond the panel by the difference of their runs.
  - **Ends:** the end allowance is added at each end.
  - **Positions:** connectors on a rear face are at the part's back; side connectors halfway.
- **Bundles:** the diameter is estimated as 1.15 × √Σd². Each wire's d is its stranded
  conductor plus 0.25 mm of insulation each side; each tube's is its bore plus 2 mm. A bundle
  that passes through a part's body in plan, within the part's depth band, is a rear warning.
- **Schematic** (`wiring/schematic.ts`):
  - **Columns** by role, in the direction power flows (amended 2026-11-03: by wiring order): battery; switches; fuses and breakers;
    powered parts; pneumatic instruments and tees; other off-panel parts.
  - **Order within columns:** barycentre sweeps.
  - **Pins** sit on the side facing what they connect to.
  - **Lines:** wires between neighbouring occupied columns are orthogonal lines, each with its
    own vertical track in the channel; channels are as wide as their track count needs.
  - **Net labels** replace lines for wires that would cross other columns.
  - **Grounds** are ground symbols (amended 2026-11-03: only wires straight to the battery).
  - **Moved blocks** keep the user's position (saved on the placed part, apart from the
    physical one).
- **Outputs:**
  - wire list as CSV and an A4 PDF;
  - wire labels: one page per label at the configured label size, two per wire;
  - wiring diagram as SVG and A3 PDF, from the same layout as the app.

## Alternatives considered

- **Nets maintained by hand.** The user would have to keep nets and wires in step. Deriving
  nets from wires removes that, and names and protection still stick.
- **A graph layout library (ELK, dagre)** for the schematic. These are heavy, and their
  generic layered layouts don't know that power should flow left to right or that ground
  belongs in symbols. The role columns read more like a hand-drawn panel diagram, and the
  readability rules are tested directly.
- **Sizing from a metric standard.** The brief names aviation charts. AC 43.13-1B is the
  standard reference for light-aircraft practice in both the UK and the US, and it is in the
  public domain.

## Consequences

- **Every value is a default:** the drop limit, wire temperature rating, minimum size, fuse
  load limit, end allowance, colours and tube bore are all editable per project. Their
  defaults are listed for confirmation in `docs/questions.md`.
- **Conservative ampacity.** Table 11-9 rates wires in large bundles at altitude, so sizing
  errs large. Paragraph 11-69's corrections for single wires and other conditions are parked.
- **Auto-route is parked.** The brief marks it optional.

## Amendment 2026-11-03: schematic columns follow the wiring

Fixed role columns assumed switch, then fuse or breaker, then load. A panel wired battery,
master, main breaker, + bus, branch breakers, switches, loads put every switch-to-load wire
two columns apart, so it showed only as net labels; and drawing every ground as a symbol
hid a ground bus, making each instrument look grounded on its own.

- **Columns** are each part's shortest distance from the battery along power wires. Fuse or
  breaker inputs jumpered together (a fuse bus) share a column. A part joined only by ground
  wires (a ground bus) goes one column right of the furthest part it collects from. Unreached
  parts take the load column, unwired switches and breakers their role column, then
  pneumatic, then other off-panel parts. With no battery wired, the role columns still apply.
- **Grounds:** only a ground wire straight to a battery negative is drawn as ground symbols.
  Other ground wires are drawn as wires, so the return through a bus or splice shows.
- A part in the `power` category without a battery capacity (a USB socket) is a load, not a
  source, in the circuit analysis and the schematic.
