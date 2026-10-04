#!/usr/bin/env python3
"""tools/knot_pen_export.py: render the woven mark (src/render/knot-pen.js)
to a still PNG, a PNG frame sequence, an MP4 and/or a GIF.

Serves the repo on a local port, opens apps/woven_mark/ in headless
Chromium, and pulls frames through its test port (window.__wovenMark).
Each frame is drawn from scratch, so stills and recordings have no
banding.

  uv run --no-project --with playwright python tools/knot_pen_export.py \
      --p 2 --q 3 --out out/trefoil            # still + 4-lap mp4 + gif
  ... --p 3 --q 4 --stroke 0.065 --laps 4 --fps 40 --seconds 12
  ... --still-only --size 1024 --hue-ratio 1

The loop is seamless when laps / hue_ratio is a whole number (default
4 laps at hue ratio 4/3 = 3 colour cycles). Needs ffmpeg for mp4/gif.
If Playwright's headless shell is not installed, pass --chrome with the
path to any Chromium/Chrome binary.
"""
import argparse, base64, functools, http.server, json, os, shutil, subprocess, sys, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--p", type=int, default=2)
    ap.add_argument("--q", type=int, default=3)
    ap.add_argument("--stroke", type=float, default=None, help="stroke / size (default 0.10 for (2,3), 0.065 otherwise)")
    ap.add_argument("--gap", type=float, default=0.5)
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--hue-ratio", type=float, default=4 / 3)
    ap.add_argument("--fade-min", type=float, default=0.4)
    ap.add_argument("--ball", type=float, default=0.9)
    ap.add_argument("--ground", default="#070707", help="'none' for transparent (PNG/still only)")
    ap.add_argument("--laps", type=float, default=4)
    ap.add_argument("--seconds", type=float, default=None, help="loop length (default 2.25 s per lap)")
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--gif-size", type=int, default=320)
    ap.add_argument("--still-only", action="store_true")
    ap.add_argument("--out", required=True, help="output path prefix, e.g. out/trefoil")
    ap.add_argument("--chrome", default=None)
    a = ap.parse_args()

    from playwright.sync_api import sync_playwright

    stroke = a.stroke if a.stroke is not None else (0.10 if (a.p, a.q) == (2, 3) else 0.065)
    opts = {"p": a.p, "q": a.q, "stroke": stroke, "gap": a.gap, "hueRatio": a.hue_ratio,
            "fadeMin": a.fade_min, "ball": a.ball, "ground": None if a.ground == "none" else a.ground,
            "gradient": "spectrum"}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    srv, base = serve()
    errors = []
    fdir = f"{a.out}-frames"
    with sync_playwright() as pw:
        b = pw.chromium.launch(**({"executable_path": a.chrome} if a.chrome else {}), headless=True)
        pg = b.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"{base}/apps/woven_mark/index.html")
        pg.wait_for_function("window.__wovenMark && window.__wovenMark.renderer()")

        # still: hue locked to position, no pen
        data = pg.evaluate("""async (o) => {
            const m = await import('/src/render/knot-pen.js');
            const c = document.createElement('canvas'); c.width = c.height = 1024;
            m.createKnotPen({ ...o, size: 1024, samples: 24000 }).drawStill(c.getContext('2d'));
            return c.toDataURL('image/png'); }""", opts)
        with open(f"{a.out}.png", "wb") as f:
            f.write(base64.b64decode(data.split(",")[1]))
        print(f"{a.out}.png")

        if not a.still_only:
            seconds = a.seconds or 2.25 * a.laps
            n = round(seconds * a.fps)
            shutil.rmtree(fdir, ignore_errors=True); os.makedirs(fdir)
            pg.evaluate("""async (o) => { const m = await import('/src/render/knot-pen.js');
                window.__exportPen = m.createKnotPen(o);
                window.__exportCanvas = document.createElement('canvas');
                window.__exportCanvas.width = window.__exportCanvas.height = o.size; }""",
                {**opts, "size": a.size, "samples": 12000 if a.size <= 1024 else 20000})
            for i in range(n):
                d = pg.evaluate("""(t) => { window.__exportPen.drawFrame(window.__exportCanvas.getContext('2d'), t);
                    return window.__exportCanvas.toDataURL('image/png'); }""", a.laps * i / n)
                with open(f"{fdir}/f{i:05d}.png", "wb") as f:
                    f.write(base64.b64decode(d.split(",")[1]))
            print(f"{fdir}/ ({n} frames, {a.laps:g} laps, {seconds:g}s)")
        b.close()
    srv.shutdown()
    if errors:
        print("page errors:", *errors, sep="\n  "); sys.exit(1)

    if not a.still_only:
        if not shutil.which("ffmpeg"):
            print("ffmpeg not found; frames left in", fdir); return
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", f"{fdir}/f%05d.png",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", "-movflags", "+faststart",
                        f"{a.out}.mp4"], check=True)
        g = a.gif_size
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", f"{fdir}/f%05d.png",
                        "-vf", f"fps=25,scale={g}:{g}:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a",
                        "-loop", "0", f"{a.out}.gif"], check=True)
        print(f"{a.out}.mp4\n{a.out}.gif")


if __name__ == "__main__":
    main()
