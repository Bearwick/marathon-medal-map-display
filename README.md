# Finishline / Medal & Map Studio

A responsive, browser-based customizer for the supplied marathon medal display. Built with TypeScript, Vite and Three.js; deployable as a static GitHub Pages site. No account, backend or API key is required.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The development server prints its local URL. The build is written to `dist/`. Tests and builds prepare the required assets automatically.

## GitHub Pages

1. Push this repository, **including the supplied `assets/` files and `package-lock.json`**, to GitHub.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main`, or run **Deploy studio to GitHub Pages** manually from the Actions tab.

The included [workflow](.github/workflows/pages.yml) installs locked dependencies, runs tests, builds and deploys. Relative asset URLs support the repository subpath, a custom domain and local preview. If your default branch is not `main`, update the workflow trigger. Deployment is configured but does not publish anything until enabled/run in GitHub.

## What you can customize

- **Plate:** standard distances from 5K through 100 miles, half/full marathon and a custom 0.1–1,000 km distance; editable title, race/location and date.
- **Results:** time, pace and BIB can each be attached, omitted or set to glue-on digits. Glue-on mode keeps the field label on the plate and leaves the value blank; BIB also keeps a fixed `#` prefix. Print the plate before the race without entering results, then download loose digits separately afterward. Pace is calculated from exact distance and finish time unless overridden. Time uses `H:MM:SS`; pace uses `M:SS/km`.
- **Colours:** independent title, location, date, distance and result colours, plate base colour, and a route-highlight colour. Loose digits match their selected field's colour.
- **Preview:** real geometry, orbit/zoom, top view and camera reset. Invalid input blocks the corresponding export and displays a specific error.
- **Files:** multipart, named-part 3MF with material colours; or a ZIP of separate binary STL bodies and print instructions. Generated 3MF is a model, not a printer-specific sliced project.
- **Complete display ZIP:** one download with a whole customized plate STL, a whole customized map STL, and all eight original assembly STL files (frames, lid, ribbon holder, plate/map spacers and both alternative medal spacers). This ZIP does not split plate lettering or map layers into separate files.

The original **143 × 222 × 3.5 mm plate base**, ribbon slot, rear geometry and assembly features are extracted from the supplied STL, not approximated by a rectangle. Existing raised lettering is removed as disconnected shells; new raised lettering is 0.8 mm high. The original source files are never modified. Other assembly pieces remain in `assets/` unchanged.

The text layout is modernized within the original lower text area. The bundled Three.js Helvetiker bold font limits the supported character set; unsupported characters and text too long for legible printing cause explicit validation errors.

## Race catalogue and course accuracy

The catalogue includes Oslo, Bergen, Copenhagen, Stockholm, Helsinki, Tokyo, Boston, London, Cape Town, Sydney, Berlin, Chicago, New York, Valencia and Paris. It stores race names, locations and organizer links, **not race dates or licensed course geometry**.

**No verified edition-specific GPX courses are bundled in this first version.** Selecting a race fills its location. Changing the race, date or distance resets any previously uploaded route/map, preventing a stale course from being labelled as a different race or edition. Users can select an approved **unofficial** community recommendation when available, upload their own GPX, or obtain the correct edition from the organizer. Courses can change annually; names and approximate paths are not enough to verify a course. The supplied map is explicitly labelled as a reference example, never as the selected race.

Catalogue research: [World Marathon Majors](https://www.worldmarathonmajors.com/), [Oslo](https://oslomaraton.no/), [Bergen](https://bergencitymarathon.no/en/), [Copenhagen](https://copenhagenmarathon.dk/en/), [Stockholm](https://stockholmmarathon.se/), [Helsinki](https://helsinkicityrun.fi/en/), [Valencia](https://www.valenciaciudaddelrunning.com/en/) and the organizer links in [the catalogue](src/data.ts). The Majors website listed eight races when checked on 11 November 2026.

## Community recommendations and proposals

The app remains static on GitHub Pages. **Recommendations are curated repository assets, not live issue attachments.** Only entries merged into [the community catalogue](public/community/catalogue.json) appear. It starts empty: no demo or fabricated course is recommended. There is no backend, write token, anonymous server upload or automatic publication.

### Submit an unofficial course

1. In step 02, upload a GPX track, a printable 3MF/STL, or both. A GPX is a route, not a printable geographic map.
2. Expand **Propose this track or map to the community**. Supply race name, edition year, official distance, HTTPS source, redistribution licence/permission, attribution and known limitations.
3. Inspect and clean the files first: remove home/start/end locations where private, activity timestamps, names and personal metadata. Check embedded original-source files in 3MF as well. **The app does not anonymize the files.** If cleaning requires changing a file, upload the cleaned version before preparing the proposal.
4. Confirm sharing permission, privacy review and public visibility. Choose **Prepare proposal ZIP**. This only downloads the original uploaded files plus metadata locally; the GitHub link carries textual proposal details, not file contents.
5. Choose **Open GitHub proposal**, sign into GitHub, attach the ZIP and submit the issue. If it exceeds GitHub's attachment limit, provide a public download link whose files may be redistributed. Preparing a ZIP or opening the issue page is **not** a completed submission.
6. Wait for maintainer review. An issue being closed or labelled does not publish it. Approval for inclusion does **not** certify organizer accuracy.

Editing/printing needs no account; proposing through GitHub requires an account. Uploads stay in memory unless you explicitly share them in a public GitHub issue or external download. The [issue template](.github/ISSUE_TEMPLATE/community-map.md) also supports submissions made directly on GitHub.

### Review and manually publish a map

Use the same process for maps you add yourself:

1. Check source ownership and redistribution permission for **both** GPX and geographic/model data. Retain all credits. Inspect for private locations and embedded personal data.
2. Compare the course against the organizer's correct **edition and distance**, noting deviations. Test GPX parsing and map import in the app, named route parts, XY size, vertical clearance and sliced printability. Do not mark an unverified community track official.
3. Copy approved files into `public/community/<course-id>/`, with simple filenames such as `route.gpx` and `map.3mf`. Include source licence/credits in the original 3MF where applicable. These files will be public.
4. Add an entry to `public/community/catalogue.json`, using this shape (illustrative only; do not publish without real reviewed files):

```json
{
  "id": "oslo-2026-marathon",
  "raceId": "oslo",
  "year": 2026,
  "distanceKm": 42.195,
  "title": "Oslo 2026 community course",
  "sourceUrl": "https://example.org/actual-course-source",
  "reviewUrl": "https://github.com/Bearwick/marathon-medal-map-display/issues/123",
  "license": "Actual redistribution licence or documented permission",
  "attribution": "Creator and all required geographic-data credits",
  "notes": "Known deviations and print limitations",
  "files": {
    "gpx": "oslo-2026-marathon/route.gpx",
    "map": "oslo-2026-marathon/map.3mf"
  }
}
```

Either file may be omitted, but at least one is required. `raceId` must exist in `src/data.ts`; add a custom race there before publishing its course. `reviewUrl` must link to this repository's actual review issue or pull request. File paths are relative to `public/community/`, never external URLs or traversal paths. Source links must use HTTPS. Multiple reviewed alternatives for an edition are supported; there is no popularity ranking or automatic selection.

5. Run `npm test` and `npm run build`, then review and merge the catalogue/files. Tests validate metadata, local file existence and file sizes; the human review must establish course accuracy, licensing and geometry quality. A Pages deployment makes the merged entry available.

Recommendations are matched to the selected race ID, **exact edition year from the race date**, and official distance (not GPX-measured distance). Users explicitly choose one. GPX-only entries load a schematic; map-only entries load printable geometry; combined entries load both. They remain labelled **Community map — unofficial**. Downloads preserve community credits in a ZIP alongside GPX, `Metadata/COMMUNITY-CREDITS.txt` within 3MF, or `COMMUNITY-CREDITS.txt` in the STL ZIP. Replacing files or changing race/date/distance clears the association.

## Detailed-map workflow

[Map2Model has shut down](https://map2model.com/). This version deliberately uses a **guided external generator**, not an undocumented API or a claim that the app generates geographic terrain itself.

1. Export your own GPS activity as GPX from the **Strava website**, or draw a route in **On The Go Map** and use its menu's GPX export.
2. Upload that GPX in step 02. The app shows a **flat route schematic**, distance and point count. This is not a terrain/building model. GPX distance does not overwrite your official plate distance.
3. Open **Mini Skyline** manually, locate the course and import the GPX in its route tools. Select city detail or terrain as appropriate for the covered area; larger courses may require terrain or project mode.
4. Choose a rectangular footprint targeting **141 × 120.914 mm**, without an additional decorative frame. Keep the route as a distinct, named, solid-colour part. Check base thickness, relief and route width for printability.
5. Export a multipart 3MF and import it back into this app. The map is **uniformly scaled** to fit within the original map footprint; it is not distorted or cropped, so a different aspect ratio leaves a margin. Scaling also changes height: verify the displayed final thickness and frame clearance.
6. Select the named route part to apply the highlight colour, then export. A single-body STL cannot distinguish a route from surrounding geography; use multipart 3MF for route-only recolouring.

There is no automatic GPX transfer to the external generator. Review its own privacy and licensing terms before using it. Original imported 3MF files are retained verbatim inside exported 3MF (`Metadata/OriginalSource.3mf`) or STL ZIP packages, preserving source attribution/licensing information. Check those credits before redistributing models or selling prints.

References, checked 11 November 2026:

- [Strava export documentation](https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export): GPX export is available on the website.
- [On The Go Map](https://onthegomap.com/): manually plan a route, then export GPX from the menu.
- [Mini Skyline features](https://miniskyline.com/features): GPX route width/height/colour, city/terrain detail and named multipart 3MF.
- [Mini Skyline map generator](https://miniskyline.com/map): browser-generated 3MF, dimensions and source-aware exports.
- [TrailPrint3D](https://trailprint3d.com/): an alternative GPX-to-terrain workflow for users comfortable with Blender.

## Print and assembly

- In step 03, choose **Download complete display · ZIP** for all printable display models in one package. If no detailed custom/community map is loaded, it includes the supplied **EXAMPLE Map — NOT SELECTED RACE**, with a warning in the interface, filename and print instructions. A GPX schematic is never substituted as a geographic map.
- Each display part has one whole STL. Plate text and base, and all map bodies, remain together in their respective files; slice touching shells as a union rather than splitting/auto-arranging them. These are complete triangle-surface models, not boolean-repaired solids. STL cannot store colour: use individual multipart 3MF exports for named filament assignment.
- If glue-on fields are selected, the same ZIP includes their loose characters under `glue-on-digits/`. Choose **Number kits for all glue-on fields** (the quantities configured in step 03 are applied to each selected field) or **Only entered result digits** (valid results required). Loose characters remain separate printable pieces, not combined with the plate. Unknown results work with kits.
- Imported 3MF source files and community credits are retained in `source-credits/` within the complete ZIP. All other assembly assets are copied unchanged, including their original coordinates; position/rotate individual parts on the bed and choose the medal spacer appropriate for your medal.
- Start with a **0.4 mm nozzle and 0.2 mm layers**; inspect text and thin geographic features in your slicer.
- Ensure your print bed fits the **143 × 222 mm** plate. Rotate in the slicer if needed.
- Prefer **3MF**: base and attached text/labels belong to one multipart plate assembly. Glue-on characters have their own separate downloads and are never included in the plate file. Assign filaments to the named parts.
- For **STL ZIPs**, import each numbered assembly's files together **as one object with multiple parts**, keeping original relative positions. Do not drop lettering to the bed independently. Slice the multipart object as a union.
- A manual filament change at **3.5 mm** can change all attached plate text together. Independent colours within the same layer require multi-material hardware or separately printed/glued parts. Colour values alone do not program your printer.
- In step 03, download **Entered results** for only the digits and colons needed by glue-on fields, or a **Number kit** containing selectable quantities (0–20 each) of `0–9` and `:`. Choose the kit's field to match its colour. Exact results require valid values, but blank/unknown glue-on results do not block plate or kit export. Glue-on BIB values are numeric, up to ten digits; attached BIBs can still contain letters or hyphens.
- Glue-on characters are **0.8 mm thick**, with **no backing, labels or `#` in the download**. Both exact results and kits use the same fixed-size characters (3.4 mm font size, maximum 2 mm glyph width). Print face-up at **100% scale**. Glue above the corresponding label using **2.4 mm character spacing**, starting at the field's left edge; start BIB digits **4 mm right of the fixed `#`**. Ten digits plus the prefix fit the 28 mm BIB field. Each colon consists of **two disconnected dots**, not a hidden backing: preserve their relative positions and use tweezers to place them. These tiny pieces can be difficult to print; inspect the sliced paths and use a finer nozzle if needed. Keep loose parts away from children.
- Imported maps are not automatically trimmed in Z or repaired. Inspect the mesh and sliced layers; check height clearance and dry-fit the supplied frames before gluing. A successful digital export cannot guarantee a physical fit on every printer.

## Privacy, limits and implementation

Uploaded GPX and map files are parsed in browser memory, never uploaded by this application or saved in local storage. Reloading clears your design and uploads. The UI currently loads Google Fonts; system fonts are used if unavailable. External organizer/help links and Mini Skyline are independent websites.

- GPX: 12 MB, 50,000 points; track and route GPX are supported. Track gaps remain separate segments. Full GPX is retained for download; only the 3D schematic is simplified.
- Maps: 100 MB upload (also applies to community map downloads); expanded 3MF archives are capped at 512 MB and 10,000 entries, with up to 5 million triangles, including repeated instances. A compressed 3MF can expand substantially beyond its upload size. Large maps may exhaust browser memory, especially on phones; these limits do not guarantee a model will fit in memory. Only millimetre 3MF files with named solid-colour/base-material parts are accepted. Textures, per-vertex colours and mixed-property colour groups are rejected because re-exporting them would discard information.
- Imported maps must be flat with Z pointing up. Scaling fits the original map's XY bounds; depth is reported but not limited automatically.
- Map imports preserve single-material versus grouped multi-material meshes so ungrouped 3MF geometry remains visible in the preview.
- Tests cover original dimensions, standard distances, validation, GPX parsing/projection, fixed glue-on labels/prefix, loose character kits/exact downloads, binary STL packaging and 3MF round-trip/material/provenance handling.
- `scripts/prepare-assets.mjs` verifies the known source plate layout and stops if its expected base-shell triangle count changes.

The supplied model owner has authorized adaptation and distribution for this project. No additional licence grant for third-party maps, race branding or uploaded files is implied.