# Pinpoint — by John Sloan

Adds landmark callouts and a house marker to edited DJI drone photos.

## How to try it on your Mac

1. Open **Terminal** in the `drone-tag` folder and run:
   `python3 -m http.server 8765`
2. Visit <http://localhost:8765> in Chrome or Safari.

(Opening `index.html` by double-clicking also works in Chrome. A small local
server like the one above is the most reliable way, and matches how the
hosted version behaves.)

## Everyday workflow

1. **Add photos** or **Add folder** (or drag photos or folders onto the
   window). Use edited JPGs exported from Lightroom with **Metadata → All
   Metadata**, and **Remove Location Info** unticked.
   - **Several properties at once:** photos are sorted into properties
     (tabs above the photo) by folder name, file name (e.g.
     `123 Main St 03.jpg`) and GPS/time. The address is looked up from
     the file/folder name plus the photo's GPS; with no name, it's guessed
     from where the drone was aimed (amber dot = check it). Red dot = type
     the address. **New property** starts one by hand. A `callouts`
     subfolder is skipped.
   - **Eye-level photos** (no drone camera data or no GPS) are marked EYE
     and left alone: tick places in *This photo* view and drag them into
     position. The ✕ on a thumbnail removes a photo (⌘Z undoes).
2. If the address wasn't found, type it and click **Find places**. Use
   **⚙ Choose types** to pick which kinds of places you use at all (for
   example, skip daycares or ponds, or leave out Farm-to-Market roads).
   Types you don't use aren't searched and don't clutter the sidebar.
   Optional types (off until you tick them): golf courses & marinas,
   colleges, hospitals, downtown skylines, airports, shopping & business
   hubs, trails, churches, libraries & city buildings. Attractions &
   landmarks (museums, zoos, pro/college stadiums, arenas, big athletic
   complexes) are on by default. Skylines, airports, business hubs and a
   few venues missing from the map come from a short hand-picked list
   (`tools/build_landmarks.py`).
3. The app works out where each school, park, lake and highway falls in the
   photo and places callouts. Only places that are actually in the frame and
   within your distance settings are listed.
   - **Whole job** view (top of the list) shows every place you can tag in
     any photo, with chips showing which photos it's in. Untick what you
     don't want anywhere. Click a photo chip to jump to that photo.
   - **Photo 01** view fine-tunes just the photo on screen: unticking
     there hides a place on that photo only.
   - Drag the **⋮⋮** handle to reorder categories (or use ▲ Up / ▼ Down
     in a category's settings). The order is remembered for every job.
4. Fine-tune:
   - Drag a **box** to move it. Drag the **dot** to move where the line points.
   - Drag the **house pin**. If the house is off the edge of the photo, click
     **📍 House pin isn't showing · Place it** (bottom left of the photo), then
     click the house. If *everything* is slightly off (drone compasses
     drift a few degrees), drag the pin onto the house, then use **Camera →
     Line up using the house pin**.
   - **Altitude** (Camera tab): shows what the photo says ("Photo says:
     210 ft") and lets you change it, 3 ft to 3,000 ft with the slider
     (finer steps at low heights) or any exact number in the box. The
     drone measures from where it *took off*, so if you launched from
     higher or lower ground than the house, set the height above the
     house. When the photo has a sea-level reading, the app compares it
     with the USGS ground height at the house and suggests a corrected
     height. **Use photo's reading** goes back to the original. Callouts
     move as you drag; ⌘Z undoes; Reset camera settings / Reset all
     changes on this photo reset it too.
   - Click a callout (or **⋯** in the list) to change text, icon and colors.
   - **Reset all changes on this photo** (Edit tab with nothing selected, or
     Camera tab) puts the camera, pin, callout positions, shown/hidden places,
     lot lines and mask on that photo back to the start. ⌘Z undoes it.
   - **⌘Z** undo, **⇧⌘Z** redo, **Delete** hides the selected callout.
   - **Scroll** over the photo to zoom (never smaller than the whole photo);
     drag an empty spot to move around; double-click to fit.
   - **Lot lines:** Style → Lot lines → Add lot lines to this photo. Each
     photo has its own outline (or none); "Copy from …" starts from another
     photo's outline without linking them. Found automatically
     anywhere in Texas from the statewide appraisal-district parcel map
     (TxGIO StratMap), with Denton, Collin, Tarrant and Dallas county maps
     as backups. Or **Draw lot lines by hand** by clicking the corners;
     scroll out to place corners past the edge of the photo. Drag corners
     to adjust, drag the small middle dots to add a corner, click a corner
     or side and press Delete to remove it. Adds "*lot lines approximate".
   - **Lines behind the house/trees:** Lot lines → **Mask this photo…**.
     Tools: **Smart select** (hover over a roof, tree or pool and click;
     downloads a 14 MB selection model the first time it's used, runs in
     the browser), **Brush** (`[` `]` change size), **Box**, **Straight
     lines** (click corners, Enter closes). **Shift** adds, **Alt**
     removes, hold **Space** to move around. Callouts always stay in front.
     Marks are **On the property** (red) or **Off the property** (blue,
     press **X** to switch).
   - **Color callout** (Lot lines → tick it): the lot stays in color and the
     rest of the photo goes gray, with the lines or without. The sky stays
     blue (found from the camera angle; "Move the sky line" fine-tunes it).
     Mask marks on the property stay in color (a roof poking past the lot);
     marks off the property go gray (a neighbor's tree inside the lot).
     "How gray" and "Darken surroundings" are saved with presets.
   - **Find a place** (bottom of the list): type a name to find any place
     this property already has, even ones that are off or out of range;
     clicking one turns it on and shows it in the list. **Search the map**
     looks further and adds the pick to My callouts.
   - **Disclaimers** (Style tab): the lot-lines note and an optional school
     note ("Buyer to verify school assignment") stack in one corner.
5. **Export this photo** or **Export all**. In Chrome a Save window asks
   where to put the photo (or, for Export all, which folder; each photo is
   saved there as its own JPG). It remembers the last folder. Safari still
   saves to Downloads (a .zip for several photos). Each file keeps the
   photo's own name plus "callout", e.g. `123 Main St 0268 callout.jpg`.

**Several photos from one flight:** set up the callouts once. Every photo
uses its own camera position, so each one is placed correctly. Your text,
icon and color edits apply to all photos. Box positions you drag are kept
per photo.

**The app remembers your work on places:**
- **My places:** a callout you add by clicking the photo is saved to *My
  places* (Presets & logos tab) and appears automatically on any future job
  within range. Pick its category (e.g. Neighborhood amenities). Drag its dot
  to correct the spot and the saved location moves too.
- **Map places you edit:** rename a map place (e.g. “Community pool” →
  “Wellington Amenity Center”) or give it a logo, and future jobs use your
  name and logo. *Forget my edits* in the Edit panel undoes this.

**Save / Open:** saves the property on screen as a small `.json` file (opens as its own tab). To reopen, click
**Open**, then add the same photos again.

**Presets & logos:** save your favorite categories, distances and style as
your default. Upload logos (school crests, highway shields) once and reuse
them. For now these (and My places) are saved in this browser. Google Drive storage comes with hosting.

## Where the data comes from

- Addresses: OpenStreetMap Nominatim (free). In Texas the house spot is
  then checked against the appraisal district's lot with that address
  (street maps sometimes put a house number on the neighbor's lot), and the
  pin goes on the biggest building on that lot.
- Places: OpenStreetMap. For DFW the app uses a **ready-made copy** stored
  with the app (`data/dfw`), so searches are instant and don't depend on
  the busy free map servers. It covers from the Red River (Gainesville,
  Whitesboro, Sherman) down to Hillsboro, and from Stephenville, Mineral
  Wells and Granbury east to Greenville. Outside that area the app
  asks the live Overpass servers (results remembered for 30 days).
- Refreshing the ready-made data: `python3 tools/build_dfw_data.py`
  (10–40 minutes). Once the app is on GitHub this runs automatically on the
  1st of each month.
- Drive time/distance: the public OSRM demo server (free, best-effort).

The code is set up so Google Places / Google Routes can be added later as
optional sources (with a spending cap and Google's attribution rules).

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `css/app.css` | Look of the app |
| `js/metadata.js` | Reads DJI camera data from the photo |
| `js/projection.js` | Camera math: map location → pixel in the photo |
| `js/places.js` | Categories and the OpenStreetMap place search |
| `js/services.js` | Address lookup, drive times, saved settings |
| `js/render.js` | Draws callouts and the pin (preview and export) |
| `js/layout.js` | Keeps callouts from overlapping |
| `js/logos.js` | Turns uploaded images into icons |
| `js/main.js` | Everything else: sidebar, editing, undo, save, export |
| `data/dfw/` | Ready-made DFW place data |
| `tools/build_dfw_data.py` | Rebuilds the DFW place data |

It's plain HTML/JS with no build step, so it can be hosted as-is on GitHub
Pages and embedded in a Squarespace page with an iframe.
