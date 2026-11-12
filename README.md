# Finishline / Medal & Map Studio

A responsive, browser-based customizer for the supplied marathon medal display. Built with TypeScript, Vite and Three.js; deployable as a static GitHub Pages site. No account, backend or API key is required.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
npm test                                  # unit tests (Vitest)
npx playwright install chromium           # once, for the browser tests
npm run test:e2e                          # end-to-end tests against a production build
npm run build
npm run preview
```

The development server prints its local URL. The build is written to `dist/`. Tests and builds prepare the required assets automatically. The end-to-end tests block all third-party requests, so they run offline.

## GitHub Pages

1. Push this repository, **including the supplied `assets/` files and `package-lock.json`**, to GitHub.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main`, or run **Deploy studio to GitHub Pages** manually from the Actions tab.

The included [workflow](.github/workflows/pages.yml) installs locked dependencies, runs the unit and end-to-end tests, builds and deploys. Relative asset URLs support the repository subpath, a custom domain and local preview. If your default branch is not `main`, update the workflow trigger. Deployment is configured but does not publish anything until enabled/run in GitHub.

## What you can customize

- **Plate:** standard distances from 5K through 100 miles, half/full marathon and a custom 0.1–1,000 km distance; editable title, race/location and date; kilometres or miles (US races default to miles); three fonts. Droid Sans/Serif Bold (the default is Droid Sans) cover Æ Ø Å Ä Ö Ü É and other accented letters; Helvetiker is basic Latin only.
- **Results:** time, pace and BIB can each be attached, omitted or set to glue-on digits. Glue-on mode keeps the field label on the plate and leaves the value blank; BIB also keeps a fixed `#` prefix. Print the plate before the race without entering results, then download loose digits separately afterward. Pace is calculated from exact distance and finish time unless overridden. Time uses `H:MM:SS`; pace uses `M:SS` per km or per mile.
- **Colours:** independent title, location, date, distance and result colours, plate base colour, and a route-highlight colour. Loose digits match their selected field's colour.
- **Map:** pick a known course or upload a GPX, drag a frame-shaped rectangle over a 2D map, and generate a printable 3D map in the browser (streets, water, parks, optional buildings and terrain, raised route). Importing a 3MF/STL made elsewhere is still supported. See [Map generator](#map-generator).
- **Preview:** real geometry, orbit/zoom, top view, camera reset, and an **Assembled** view that shows the plate and map in the supplied frames (approximate). Invalid input blocks the corresponding export and displays a specific error.
- **Save and share:** the design, map area and style are saved in this browser automatically. **Copy share link** puts them in a URL; **Start over** clears them. Uploaded files are never saved or shared.
- **Files:** plate, map and glue-on digits as multipart, named-part 3MF with material colours, or as a ZIP of separate binary STL bodies with print instructions. Generated 3MF is a model, not a printer-specific sliced project.
- **Complete display ZIP:** one download with a whole customized plate STL, a whole customized map STL, and all eight original assembly STL files (frames, lid, ribbon holder, plate/map spacers and both alternative medal spacers). This ZIP does not split plate lettering or map layers into separate files.

The original **143 × 222 × 3.5 mm plate base**, ribbon slot, rear geometry and assembly features are extracted from the supplied STL, not approximated by a rectangle. Existing raised lettering is removed as disconnected shells; new raised lettering is 0.8 mm high. The original source files are never modified. Other assembly pieces remain in `assets/` unchanged.

The text layout is modernized within the original lower text area. The bundled Three.js Helvetiker bold font limits the supported character set; unsupported characters and text too long for legible printing cause explicit validation errors.

## Race catalogue and known courses

The race list includes Oslo, Bergen, Copenhagen, Stockholm, Helsinki, Tokyo, Boston, London, Cape Town, Sydney, Berlin, Chicago, New York, Valencia and Paris. It stores race names, locations, organizer links, a city centre (to position the map picker) and default units. It does **not** store race dates or licensed course geometry.

**Known courses** are curated GPX files in [the course catalogue](public/community/catalogue.json). Step 02 lists the courses for the selected race and official distance, best match first: the exact edition year, then the most recent earlier editions, then later ones. If the year differs from the plate date, the card warns that the course may differ from your edition. Choosing a course loads its route, fits the map frame to it, and fills the plate date when the entry has one.

The catalogue ships with one maintainer-added course: the **Boston Marathon**, traced from OpenStreetMap relation [11680552](https://www.openstreetmap.org/relation/11680552) (ODbL 1.0, 42.38 km). It is the long-standing Hopkinton → Boylston Street course, but it has not been checked against the organizer's map for a specific edition. All courses are labelled unofficial. Changing the race clears the course. Changing the distance clears it only if it no longer matches. Changing the date keeps the course and shows the edition warning.

Courses change between editions, and names or approximate paths are not enough to verify one. Compare with the organizer before printing.

Catalogue research: [World Marathon Majors](https://www.worldmarathonmajors.com/), [Oslo](https://oslomaraton.no/), [Bergen](https://bergencitymarathon.no/en/), [Copenhagen](https://copenhagenmarathon.dk/en/), [Stockholm](https://stockholmmarathon.se/), [Helsinki](https://helsinkicityrun.fi/en/), [Valencia](https://www.valenciaciudaddelrunning.com/en/) and the organizer links in [the catalogue](src/data.ts). The Majors website listed eight races when checked on 11 November 2026.

### Adding a course from OpenStreetMap (maintainers)

Many races are mapped in OpenStreetMap as route relations (`type=route`, `route=running`). To add one:

```sh
npm run course:osm -- <relationId> public/community/<race-id>/<course-id>/route.gpx
```

The script fetches the relation from Overpass and stitches its ways in order, joining pieces whose ends are within 50 m. It then simplifies the track to 5 m and writes a timestamp-free GPX carrying ODbL attribution. **It warns when gaps remain.** Do not publish a course with gaps: the generated map would draw straight lines across them. For example, the London Marathon relation was left out because it still had gaps of up to 1.7 km. Then add a catalogue entry with `"curation": "maintainer"`, the relation URL as `sourceUrl`, `"license": "Open Database License (ODbL) 1.0"`, `"attribution": "© OpenStreetMap contributors"` and notes on what was and wasn't verified. `npm test` checks that every bundled GPX parses, contains no timestamps and is within 3% of the official distance.

## Community recommendations and proposals

The app remains static on GitHub Pages. **Recommendations are curated repository assets, not live issue attachments.** Only entries merged into [the course catalogue](public/community/catalogue.json) appear. No demo or fabricated course is listed. There is no backend, write token, anonymous server upload or automatic publication.

### Submit an unofficial course

1. In step 02, upload a GPX track, a printable 3MF/STL (under **Advanced**), or both.
2. Expand **Propose this track or map to the community**. Supply race name, edition year, official distance, HTTPS source, redistribution licence/permission, attribution and known limitations.
3. Inspect and clean the files first: remove home/start/end locations where private, activity timestamps, names and personal metadata. Check embedded original-source files in 3MF as well. **The app does not anonymize the files.** If cleaning requires changing a file, upload the cleaned version before preparing the proposal.
4. Confirm sharing permission, privacy review and public visibility. Choose **Prepare ZIP**. This only downloads a ZIP locally: a `<race-id>/<course-id>/` folder with the uploaded files, `catalogue-entry.json` (a ready-to-paste entry in exactly the catalogue schema below), and maintainer instructions. The GitHub link carries the text of the proposal, not file contents.
5. Choose **Open GitHub proposal**, sign into GitHub, attach the ZIP and submit the issue. If it exceeds GitHub's attachment limit, provide a public download link whose files may be redistributed. Preparing a ZIP or opening the issue page is **not** a completed submission.
6. An automatic review comment appears on the issue within a minute or two, listing any problems (for example a distance mismatch). Fix them by attaching a corrected ZIP and editing the issue; the comment updates. Then wait for maintainer review. Only a merged pull request publishes a course. Approval for inclusion does **not** certify organizer accuracy.

Editing/printing needs no account; proposing through GitHub requires an account. Uploads stay in memory unless you explicitly share them in a public GitHub issue or external download. The [issue template](.github/ISSUE_TEMPLATE/community-map.md) also supports submissions made directly on GitHub.

### Review and publish a suggested course

Courses are stored in one folder per race and one subfolder per course: `public/community/<race-id>/<course-id>/route.gpx` (and/or `map.3mf` / `map.stl`), e.g. `oslo/oslo-2026-half/` and `oslo/oslo-2026-marathon/`. The catalogue check enforces this layout.

**One-label flow (recommended).** The [intake workflow](.github/workflows/add-course.yml) runs [`scripts/add-course.mjs`](scripts/add-course.mjs) on every `[Community course]` issue that is opened or edited, and posts a **course intake report** comment. The report shows the race/edition/distance, the GPX distance against the official one, private data it will strip (timestamps, waypoints, device extensions, author/email), start and finish on OpenStreetMap, large gaps, map dimensions and depth, and whether the catalogue entry is valid. As the reviewer:

1. Read the report and complete its checklist: the licence or permission is real, the route matches the organizer's course for that edition, start and finish are not private places, and the credits read well.
2. Add the **`approve-course`** label. The workflow adds the course folder and catalogue entry (with `reviewUrl` pointing at the issue), runs `npm test`, opens a pull request with the report and `Closes #<issue>`, and links it on the issue. If anything fails it comments the reason and removes the label so you can re-apply it after a fix.
3. Merge the pull request. The Pages deployment publishes the course.

One-time setup: create the `approve-course` label, and enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**. The workflow only downloads `https://github.com/user-attachments/…` ZIPs and passes issue text through environment variables only.

**Locally**, the same script does everything except the pull request:

```sh
npm run course:add -- ~/Downloads/finishline-community-proposal.zip --issue 123 --dry-run   # report only
npm run course:add -- ~/Downloads/finishline-community-proposal.zip --issue 123             # add it
npm run course:add -- proposal.zip --maintainer   # a course you add yourself (no review issue)
```

It also accepts the attachment URL instead of a file, `--replace` to update an existing course and `--report <file>` to save the report. It writes only `public/community/<race-id>/<course-id>/` and the new catalogue entry, and only when every check passes; then run `npm test`, commit and open a pull request.

**Manually** (fallback, or for maps you add yourself without a proposal ZIP):

1. Check source ownership and redistribution permission for **both** GPX and geographic/model data. Retain all credits. Inspect for private locations and embedded personal data.
2. Compare the course against the organizer's correct **edition and distance**, noting deviations. Test GPX parsing and map import in the app, named route parts, XY size, vertical clearance and sliced printability. Do not mark an unverified community track official.
3. Copy approved files into `public/community/<race-id>/<course-id>/`, with simple filenames such as `route.gpx` and `map.3mf`. Include source licence/credits in the original 3MF where applicable. These files will be public.
4. Add an entry to `public/community/catalogue.json`. For a proposal, paste its `catalogue-entry.json` and replace `ISSUE_NUMBER` in `reviewUrl`; for a course you add yourself, set `"curation": "maintainer"` and remove `reviewUrl`. The shape (illustrative only; do not publish without real reviewed files):

```json
{
  "id": "oslo-2026-marathon",
  "raceId": "oslo",
  "curation": "community",
  "year": 2026,
  "date": "2026-09-12",
  "distanceKm": 42.195,
  "title": "Oslo 2026 community course",
  "sourceUrl": "https://example.org/actual-course-source",
  "reviewUrl": "https://github.com/Bearwick/marathon-medal-map-display/issues/123",
  "license": "Actual redistribution licence or documented permission",
  "attribution": "Creator and all required geographic-data credits",
  "notes": "Known deviations and print limitations",
  "files": {
    "gpx": "oslo/oslo-2026-marathon/route.gpx",
    "map": "oslo/oslo-2026-marathon/map.3mf"
  }
}
```

Either file may be omitted, but at least one is required. `raceId` must exist in `src/data.ts`; add a custom race there before publishing its course. For `"curation": "community"` (the default), `reviewUrl` must link to this repository's actual review issue or pull request; maintainer-added entries may omit it. `date` is optional, must fall in `year`, and fills the plate date when the course is chosen. File paths are relative to `public/community/` and must be inside `<raceId>/<id>/`; never external URLs or traversal paths. Source links must use HTTPS. Multiple reviewed alternatives for an edition are supported; there is no popularity ranking or automatic selection.

5. Run `npm test` and `npm run build`, then commit and open a pull request. `npm test` fails on any invalid entry; the app itself skips invalid entries, lists them under the known courses, and still shows the valid ones. Tests validate metadata, local file existence and file sizes; the human review must establish course accuracy, licensing and geometry quality. A Pages deployment makes the merged entry available.

Courses are matched to the selected race ID and official distance (not GPX-measured distance), ranked by edition year as described above. Users explicitly choose one. GPX entries load the route, ready for map generation; map entries load printable geometry. They stay labelled **Known course — unofficial** or **Community map — unofficial**. Downloads keep the credits: in a ZIP next to the GPX, as `Metadata/CREDITS.txt` inside 3MF files, as `CREDITS.txt` in STL ZIPs, and as `source-credits/CREDITS.txt` in the complete ZIP.

## Map generator

Step 02 builds a printable, multipart 3D map in the browser, with no account, API key or backend:

1. **Choose a route:** a known course, or your own GPX (export it from the [Strava website](https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export) or draw one in [On The Go Map](https://onthegomap.com/)). GPX distance never overwrites the official plate distance. You can also frame an area without a route.
2. **Frame the map:** a 2D map ([MapLibre](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) tiles) shows the route and the print frame. The solid rectangle is the visible 133 × 117 mm window; the dashed outline is the full tile. The frame fits the route automatically, in the orientation that fills the window best. Drag it to move it; use the sliders for width (0.3–120 km) and rotation, or **Fit to route**, **Rotate 90°** and **Centre on city**. The summary shows the scale and which roads will be printed.
3. **Style:** toggle route, roads, water, parks & woods, terrain relief and buildings. Set base thickness (1.0–1.7 mm), road width, terrain exaggeration, building height and the colours of each part.
4. **Generate:** a Web Worker downloads [OpenMapTiles](https://openmaptiles.org/)-schema vector tiles for the framed area (zoom 14, or lower for large areas, at most 36 tiles) and, with terrain on, [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/) (at most 16 tiles). It then builds the mesh. Changing the area or style marks the map as out of date. Colour changes apply immediately without regenerating.

**What gets printed.** Each layer is a separate named part, so the 3MF can be assigned filaments: `Map base`, `Water`, `Parks`, `Roads`, `Buildings` and `Route`.
- **Map base:** a flat slab, or a terrain surface over the window plus a flat rim out to the 141 × 120.9 mm tile.
- **Water and parks:** raised 0.3 mm.
- **Roads:** raised 0.6 mm and at least 0.5 mm wide. Narrow streets are dropped on large areas: all streets below 4 km, local streets below 10 km, then main roads only.
- **Buildings:** footprints extruded 0.4–1.6 mm from their mapped heights. They need a small area, since building data only exists at high zoom.
- **Route:** 1.5 mm wide, raised 1.2 mm, using the route highlight colour.

Terrain is smoothed and scaled down automatically so the whole map stays within **4.7 mm**; steep cities like Bergen print at well under 1× vertical scale. Parts are closed shells that may overlap; slice each multipart object as a union. Large flat water or park areas over steep terrain are triangulated coarsely and may sit slightly above or below the surface, so check them in the slicer.

**Data and privacy.** Generating sends the framed area's tile requests to OpenFreeMap and AWS. **The GPX itself is never uploaded.** The 2D picker loads the same OpenFreeMap tiles. Generated files carry the required attribution: © OpenStreetMap contributors (ODbL 1.0), OpenMapTiles/OpenFreeMap, and the Terrain Tiles sources. Exports also include the generation settings (`MAP-SETTINGS.json` in the complete ZIP), so a map can be reproduced. Keep the attribution when you share or sell prints or files.

### Importing a map made elsewhere

Under **Advanced: import your own 3MF/STL map** you can still import a multipart 3MF (or single-body STL) from another generator such as [Mini Skyline](https://miniskyline.com/map) or [TrailPrint3D](https://trailprint3d.com/) ([Map2Model has shut down](https://map2model.com/)). Target a 133 × 117 mm footprint and keep the route as a separate, named, solid-colour part, so you can pick it for the route highlight. To reduce Mini Skyline file size, turn off landmark models, detailed stadiums, dormers and chimneys, stepped towers, church towers, minarets and domes, window detail and bay windows, and choose thicker detail.

Imported maps that already fit the 141 × 120.9 mm tile keep their size. Larger maps are scaled down uniformly to fit it, and maps smaller than the 133 × 117 mm window are scaled up to fill it. They are never distorted or cropped. When a map is narrower than the tile, the app adds a thin **mounting rim** part so the frame lip can hold it. Maps deeper than 4.7 mm get a warning that they will stand proud of the frame. Original imported 3MF files are kept verbatim inside exported 3MF (`Metadata/OriginalSource.3mf`) or STL ZIPs, preserving source attribution and licensing. Check those credits before redistributing models or selling prints.

## Print and assembly

- In step 03, choose **Download complete display · ZIP** for all printable display models in one package. If no map has been generated or imported, it includes the supplied **EXAMPLE Map — NOT SELECTED RACE**, with a warning in the interface, filename and print instructions. A GPX schematic is never substituted for a map.
- Each display part has one whole STL. Plate text and base, and all map bodies, remain together in their respective files; slice touching shells as a union rather than splitting/auto-arranging them. These are complete triangle-surface models, not boolean-repaired solids. STL cannot store colour: use individual multipart 3MF exports for named filament assignment.
- If glue-on fields are selected, the same ZIP includes their loose characters under `glue-on-digits/`. Choose **Number kits for all glue-on fields** (the quantities configured in step 03 are applied to each selected field) or **Only entered result digits** (valid results required). Loose characters remain separate printable pieces, not combined with the plate. Unknown results work with kits.
- Imported 3MF source files, map-data and course credits, and generated-map settings are kept in `source-credits/` within the complete ZIP. All other assembly assets are copied unchanged, including their original coordinates; position/rotate individual parts on the bed and choose the medal spacer appropriate for your medal.
- Start with a **0.4 mm nozzle and 0.2 mm layers**; inspect text and thin geographic features in your slicer.
- Ensure your print bed fits the **143 × 222 mm** plate. Rotate in the slicer if needed.
- Prefer **3MF**: base and attached text/labels belong to one multipart plate assembly. Glue-on characters have their own separate downloads and are never included in the plate file. Assign filaments to the named parts.
- For **STL ZIPs**, import each numbered assembly's files together **as one object with multiple parts**, keeping original relative positions. Do not drop lettering to the bed independently. Slice the multipart object as a union.
- A manual filament change at **3.5 mm** can change all attached plate text together. Independent colours within the same layer require multi-material hardware or separately printed/glued parts. Colour values alone do not program your printer.
- In step 03, download **Entered results** for only the digits and colons needed by glue-on fields, or a **Number kit** containing selectable quantities (0–20 each) of `0–9` and `:`. Choose the kit's field to match its colour. Exact results require valid values, but blank/unknown glue-on results do not block plate or kit export. Glue-on BIB values are numeric, up to ten digits; attached BIBs can still contain letters or hyphens.
- Glue-on characters are **0.8 mm thick**, with **no backing, labels or `#` in the download**. Both exact results and kits use the same fixed-size characters (3.4 mm font size, maximum 2 mm glyph width). Print face-up at **100% scale**. Glue above the corresponding label using **2.4 mm character spacing**, starting at the field's left edge; start BIB digits **4 mm right of the fixed `#`**. Ten digits plus the prefix fit the 28 mm BIB field. Each colon consists of **two disconnected dots**, not a hidden backing: preserve their relative positions and use tweezers to place them. These tiny pieces can be difficult to print; inspect the sliced paths and use a finer nozzle if needed. Keep loose parts away from children.
- **Map fit:** the lower frame's visible window is about 133 × 117 mm. Behind it, a 144 mm wide pocket has 5 mm side lips at z = 13 mm, above the 8.28 mm map spacer on the 3 mm floor. The map tile is therefore 141 × 120.9 mm, the same as the supplied example, and its edge must be at most 1.7 mm thick to slide under the lips; generated maps meet both. A map up to 4.7 mm deep sits flush with the 16 mm frame front. These figures were measured from the supplied STLs, so dry-fit before gluing.
- The **Assembled** preview arranges the frames, lid, spacer, plate and map from the same measurements. It is a visual check, not a fit guarantee.
- Imported maps are not automatically trimmed in Z or repaired. Inspect the mesh and sliced layers; check height clearance and dry-fit the supplied frames before gluing. A successful digital export cannot guarantee a physical fit on every printer.

## Privacy, limits and implementation

Uploaded GPX and map files are parsed in browser memory and are never uploaded by this application or saved. The design itself is saved in this browser: plate text and results, colours, map area and style, and the chosen course. **Start over** clears it. **Copy share link** puts the same information, including your results and BIB, in the link's `#` fragment; it is never sent to a server by the app, but anyone you share the link with can read it. The interface fonts (DM Sans, Manrope) are self-hosted. In step 02 the 2D picker and the map generator request map tiles for the shown/framed area from OpenFreeMap and AWS Terrain Tiles, as described in [Map generator](#map-generator). External organizer and help links are independent websites.

- GPX: 12 MB, 50,000 points; track and route GPX are supported. Track gaps remain separate segments. The full GPX is kept for download; only the preview and map are simplified.
- Generated maps: area 0.3–120 km wide, at most 36 vector tiles and 16 terrain tiles, and 3 million triangles. Choose a smaller area or turn off buildings if a map is too detailed.
- Imported maps: 100 MB upload (also applies to community map downloads). Expanded 3MF archives are capped at 512 MB and 10,000 entries, with up to 5 million triangles including repeated instances. A compressed 3MF can expand far beyond its upload size, and large maps may exhaust browser memory, especially on phones; these limits don't guarantee a model fits in memory. Only millimetre 3MF files with named solid-colour/base-material parts are accepted. Textures, per-vertex colours and mixed-property colour groups are rejected because re-exporting them would discard information.
- Imported maps must be flat with Z pointing up.
- Map imports preserve single-material versus grouped multi-material meshes so ungrouped 3MF geometry remains visible in the preview.
- Unit tests cover:
  - plate: original dimensions, standard distances, validation, units, Nordic fonts, fixed glue-on labels/prefix, loose character kits/exact downloads;
  - GPX and courses: GPX parsing, curated course files, catalogue ranking;
  - map: projection, clipping, the map generator (named parts, watertight base, depth/rim limits, road selection), imported map fitting;
  - files: binary STL packaging, 3MF round-trip/material/provenance handling, complete ZIP contents;
  - persistence: saved/shared state sanitising.

  End-to-end tests drive a production build in Chromium: plate → GPX → route map → assembled view → complete ZIP → reload, plus the Boston course.
- `scripts/prepare-assets.mjs` verifies the known source plate layout and stops if its expected base-shell triangle count changes. It also writes a decimated preview of the example map (3.3 MB instead of 26.7 MB); the complete ZIP still uses the original file.

The supplied model owner has authorized adaptation and distribution for this project. No additional licence grant for third-party maps, race branding or uploaded files is implied.