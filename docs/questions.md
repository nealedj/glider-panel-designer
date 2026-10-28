# Outstanding questions

Things only you can answer or check. Each one says what depends on it. Tick them off, or
answer in a message, whenever suits. Work carries on with the stated assumption meanwhile.

## Measurements and checks on real things

1. **M3: print check.** Print the sample project's template (Export › Printable template) at
   100 % and measure the check bar with a ruler. It should be exactly 100 mm. Ideally also
   hold a printed 57 mm and 80 mm cutout against real instruments.
   *Depends on it:* trust in every printed template.
2. **M4: mock-up spans.** Measure these on the real cardboard mock-up with a steel rule. The
   template says: A. widest point of the top section, side to side: 397.5 mm; B. bottom edge
   of the stem, corner to corner: 139.0 mm; C. dashed fold line to the top edge, along the
   centreline: 292.2 mm; optional D. full height along the centreline: 336.5 mm. Each should
   agree within ±1.5 mm. *Depends on it:* M4's first acceptance criterion.
3. **M4: card thickness.** The mock-up card was assumed to be 3.5 mm thick. It changes the
   scale by about 1 %. *Depends on it:* the PIK-20D template's size.
4. **M4: instrument rim diameters.** In the current-panel photo, the black outer rims were
   given as 80 mm (ASI, XCVario, mechanical vario, altimeter) and 57 mm (slip ball, compass,
   KRT2). A caliper across one of each would confirm them. If a rim is really 82 mm,
   everything from that photo scales by 2.5 %.
5. **M1/M2: template hole spacing.** The generic instruments use 47 mm (57 mm instrument)
   and 66 mm (80 mm instrument) screw spacing, measured from your photo of the yellow
   marking templates, which had no scale. A caliper across the hole centres would confirm
   them.

## Defaults to confirm

6. **M4: baseline error per input type**, used in every template's stated error: scan
   0.2 mm, card on a mat 0.5, tracing 0.5, square-on photo 1.5, angled photo 3, measured
   0.5. These are my judgement.
7. **M4: new PIK-20D panel thickness.** It is 2 mm glass fibre as a placeholder. The real
   laminate thickness is needed before cutting, and it decides the screw lengths.
8. **M4: free depth behind the PIK-20D panel**, and the canopy clearance in front. Both are
   unknown, so the depth and protrusion checks can't run yet.
9. **M3: defaults.** A4 paper only, a 12 mm tile overlap, and the template's panel fixing
   holes included on the screw-hole layer of cut files. Change any of these?

## Discovery (M5)

10. **Crawler contact address.** The brief requires the crawler to identify itself with a
    contact address in its User-Agent. Which address or URL should it use? Until there is
    one, the tools refuse to make live requests. *Depends on it:* any live crawl.
11. **Permission to crawl.** May I run the crawl against the retailer and the maker sites
    myself, once there is a contact address, or will you run it? It sends about one request
    a second, obeys robots.txt and caches everything, so a re-run sends nothing.
12. **Retailer terms.** Please check the retailer's terms of use allow automated reading of
    product pages for personal, non-commercial cataloguing. I can't judge that for you.
13. **Python dependencies for the maintainer tools:** pdfplumber (MIT), pypdfium2
    (Apache-2.0 / BSD-3), Pillow (MIT-CMU) and pytest (MIT). They are maintainer-only and not
    shipped. OK?
14. **Reviewing.** Only you (or someone you trust) can mark catalogue values verified. M5's
    acceptance needs every part in the reference panel reviewed, and at least 20 parts overall.
15. **The reference panel's exact parts.** For each, please give the maker and model, so the tools can find
    the right manual:
    - the ASI and the altimeter (Winter? which models, 57 or 80 mm?);
    - the mechanical vario and the slip ball;
    - the compass (maker?);
    - the "XCTN7v3", the 5.7-inch XCTouchNav (who makes it, and is there a manual?);
    - the FLARM display (the current panel has an LX FLARM display: LXNAV FlarmView,
      FlarmView57, or another?);
    - the phone mount (RAM? which base?);
    - the toggle switches and fuse holders.

    Only the XCVario and the KRT2 are in `tools/products.toml` so far.
16. **Maker download pages.** These adapters start from addresses I could not check against
    the live sites: FLARM, Trig, f.u.n.k.e., Naviter, Winter and PilotAware. LXNAV, XCVario,
    Air Avionics and TQ (KRT2) start from pages or files I found. The first live
    `check-adapters` run will show which need fixing. If you know the right download pages,
    tell me.

## Wiring (M6)

17. **Wiring defaults.** Each of these is editable per project; please confirm or correct the
    defaults:
    - **Wire temperature rating:** 105 °C, the conservative column of AC 43.13-1B table 11-9.
      Tefzel aviation wire (M22759/16) is 150 °C; if that is what you will use, the sizes come
      out smaller.
    - **Voltage drop limit:** 0.5 V from the battery to a load and back. That is table 11-6's
      figure for a 14 V system; gliders run at 12–13 V.
    - **Fuse load limit:** continuous load below 80 % of a fuse or breaker's rating. This is
      common practice, not in the AC.
    - **Smallest wire:** AWG 22.
    - **End allowance:** 50 mm per wire end, for termination and a service loop.
    - **Label size:** 40 × 12 mm per label.
18. **Colours.** Wires: power red, ground black, a different colour for each data link,
    audio shielded pair, RF coax. Tubes: pitot green, static clear, TE blue, each 4 mm bore.
    These are my choices; the brief only asks for distinct tube colours. Change them, or the
    bore, to match the tubing you have?
19. **Generic placeholder currents.** Electric vario 0.15 A, FLARM 0.15 A, flight computer
    0.5 A, radio 0.25 A (receiving). They are unverified, like all generic values; real
    figures come from the reviewed catalogue (M5).
20. **Battery capacity.** The generic battery defaults to 7.2 Ah at 12 V, for the endurance
    estimate. What are the glider's batteries?

## Housekeeping

21. **Git.** The repo has been initialised but has no commits. Shall I make the first commit,
    and create a GitHub repo and push, so CI and GitHub Pages run? I'll confirm before any
    push.
22. **Reference-panel photos in the public repo.** `fixtures/pik20d/` holds your two photos.
    The repo is meant to be public. Are you happy for them to be published? In the copy of the
    current-panel photo there, the registration placard is painted out; the original at the
    repo root is untouched and stays local.

## PIK-20D example project (M7)

23. **The example's electrics.** The PIK-20D example's wiring is my plausible layout, not
    the aircraft's. Please correct whatever differs:
    - fuse ratings: F1 XCVario 2 A, F2 FLARM (unit and display) 2 A, F3 XCTouchNav 3 A,
      F4 radio 5 A, and a 5 A main fuse at the battery;
    - data links: FLARM port 1 to the FLARM display, port 2 to the XCVario, and the
      XCVario's second port to the XCTouchNav (or does the XCTouchNav get its data by Wi-Fi
      or Bluetooth?);
    - where the FLARM unit is: I put it on the back of the XCTouchNav;
    - does the phone mount need power (a USB socket)?
    *Depends on it:* the wiring diagram, wire list and sizing for the example.
24. **Off-panel runs and the exit.** How far is it from where the loom leaves the panel to the
    battery, the stick PTT, the speaker, each antenna, and the pitot, static and TE
    connections? And where does the loom leave the panel (I assumed down the stem)? Until
    these are set, the example's wire lengths stop at the panel exit.
25. **Switch and fuse positions.** The mock-up does not show the master switch or the fuse
    holders. I put them on the stem, either side of the altimeter and clear of the fold. Is
    that where you want them, and is one master switch right (the current panel has a row of
    toggles)?
26. **Placeholder sizes from the mock-up.** The XCTouchNav cutout (100 × 156 mm), FLARM
    display cutout (47 × 14 mm) and phone mount plate (56 × 49 mm) are the spaces drawn on the
    mock-up less a bezel, not datasheet values. They must be replaced before cutting. The
    XCVario is taken as an 80 mm instrument from the size of its space: is it?
27. **Fixing holes.** The mock-up template has no panel fixing holes. The current panel has
    two at the foot of the stem. Where are the new panel's? (They go on the template, and
    the checks keep cuts clear of them.)
28. **Open pins before any wiring.** Until the first wire is drawn, open power and ground pins
    show as one note ("Wiring not started"), not an error per pin, so a front layout alone can
    be exported. Once wiring starts, each open pin is an error again. OK?
29. **Crash-recovery snapshots.** A snapshot every three minutes while editing, and before any
    project replaces the working copy; the newest 30 are kept in the browser. Enough?
