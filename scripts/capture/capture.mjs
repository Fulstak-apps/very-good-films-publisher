import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { readExactPost } from "./post-metadata.mjs";
import { assembleRanges } from "./media-ranges.mjs";

const execFileAsync = promisify(execFile);

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// This is the already-authenticated source-viewing profile used by the working
// local repost monitor. It only reads the three allowlisted source accounts;
// all VGF output is rendered and published through this repository.
const profileDir = process.env.VGF_SOURCE_PROFILE_DIR || path.join(os.homedir(), "Library", "Application Support", "RapWire", "InstagramMirrorProfile");
const outputDir = path.resolve("work", "instagram-mirror");

async function launch(headless = false) {
  await fs.mkdir(profileDir, { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        executablePath: chromePath,
        headless,
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true
      });
    } catch (error) {
      lastError = error;
      if (!/ProcessSingleton|SingletonLock|profile directory/i.test(error.message || "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500 + attempt * 1000));
    }
  }
  throw lastError;
}

async function assertSourceLogin(page) {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForTimeout(2500);
  // The shared source-viewing profile is authenticated as @rapwire247. The
  // inbox route is sometimes lazy-rendered, so accept either stable signed-in
  // signal instead of falsely declaring a healthy session logged out.
  const profileLink = page.locator('a[href="/direct/inbox/"], a[href="/rapwire247/"]');
  if (!(await profileLink.count())) {
    throw new Error("Source profile is not logged into Instagram. Run capture.mjs login.");
  }
}

async function login() {
  const context = await launch(false);
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  console.log("Sign into your source-viewing Instagram account in this dedicated window, then close the window. The login will be reused by scheduled runs.");
  // Login is intentionally interactive and may take longer than Playwright's
  // default 30-second event timeout.
  await new Promise((resolve) => context.once("close", resolve));
}

async function capture(reelUrl, options = {}) {
  if (!/^https:\/\/www\.instagram\.com\/(?:[^/]+\/)?(?:reel|p)\/[A-Za-z0-9_-]+\/?/.test(reelUrl)) {
    throw new Error("capture requires a full Instagram reel or video-post URL");
  }
  const {approvedSource}=await import("../../src/source-policy.mjs");
  if(!approvedSource(reelUrl))throw new Error("Source account is not approved");
  await fs.mkdir(outputDir, { recursive: true });
  const shortcode = reelUrl.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)[1];
  const destination = path.join(outputDir, `${shortcode}.mp4`);
  const context = await launch(options.headless === true);
  try {
    const page = context.pages()[0] || await context.newPage();
    await assertSourceLogin(page);
    const candidates = [];
    page.on("response", async (response) => {
      try {
        const headers = await response.allHeaders();
        const type = headers["content-type"] || "";
        if (!type.startsWith("video/") && !type.startsWith("audio/") && !/\.(?:mp4|webm)(?:\?|$)/i.test(response.url())) return;
        const body = await response.body();
        if (body.length) candidates.push({ body, type, url: response.url(), headers, status: response.status() });
      } catch {
        // Streaming responses may be unavailable until playback completes.
      }
    });
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const video = page.locator("video:visible").first();
    await video.waitFor({ state: "visible", timeout: 15_000 });
    // Clicking blindly may pause autoplay, leaving only the first media range.
    await video.evaluate(element => { element.muted = false; return element.play().catch(() => { element.muted = true; return element.play(); }); });
    await page.waitForTimeout(3000);
    const sourceEvidence = await readExactPost(page, reelUrl);
    const bufferDeadline = Date.now() + Math.min(240000, (sourceEvidence.duration + 15) * 1000);
    let fullyBuffered = false;
    while (Date.now() < bufferDeadline) {
      const buffered = await video.evaluate(element => ({ end: element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0, duration:element.duration }));
      if (buffered.end >= buffered.duration - 0.25) { fullyBuffered = true; break; }
      await page.waitForTimeout(2500);
    }
    // Let response.body() handlers finish after the last buffered segment.
    await page.waitForTimeout(1500);
    if (!candidates.length) throw new Error("No authenticated video response was captured from Instagram.");
    const groups = new Map();
    for (const item of candidates) {
      const parsed = new URL(item.url);
      const rangeStart = Number(item.headers["content-range"]?.match(/bytes (\d+)-/)?.[1] ?? parsed.searchParams.get("bytestart") ?? 0);
      const rangeEndValue = item.headers["content-range"]?.match(/bytes \d+-(\d+)/)?.[1] ?? parsed.searchParams.get("byteend");
      const rangeEnd = rangeEndValue == null ? undefined : Number(rangeEndValue);
      parsed.searchParams.delete("bytestart");
      parsed.searchParams.delete("byteend");
      const key = parsed.toString();
      const group = groups.get(key) || [];
      group.push({ ...item, rangeStart, rangeEnd });
      groups.set(key, group);
    }
    const assembled = [...groups.values()]
      .map((parts) => ({ parts: parts.sort((a, b) => a.rangeStart - b.rangeStart), bytes: parts.reduce((sum, part) => sum + part.body.length, 0) }))
      .sort((a, b) => b.bytes - a.bytes);
    const tempDir = await fs.mkdtemp(path.join(outputDir, `${shortcode}-`));
    let videoInput = "";
    let audioInput = "";
    try {
      const matchedVideos = [];
      const matchedAudio = [];
      const diagnostics = [];
      for (let index = 0; index < assembled.length; index += 1) {
        const bytes = assembleRanges(assembled[index].parts, { allowBufferedRanges:fullyBuffered });
        if (!bytes) { diagnostics.push({ index, result:'incomplete', ranges:assembled[index].parts.map(part => [part.rangeStart,part.body.length,part.headers['content-range'] || part.status]) }); continue; }
        const candidatePath = path.join(tempDir, `stream-${index}.bin`);
        await fs.writeFile(candidatePath, bytes);
        try {
          const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", candidatePath]);
          const probe = JSON.parse(stdout);
          diagnostics.push({index,result:'probed',...probe});
          if (Math.abs(Number(probe.format?.duration) - sourceEvidence.duration) > 1 || !Number(probe.format?.duration)) continue;
          const videoStream = probe.streams?.find(stream => stream.codec_type === "video");
          const hasAudio = probe.streams?.some(stream => stream.codec_type === "audio");
          if (videoStream && videoStream.width === sourceEvidence.width && videoStream.height === sourceEvidence.height) matchedVideos.push({ path: candidatePath, hasAudio });
          else if (!videoStream && hasAudio) matchedAudio.push(candidatePath);
        } catch {
          diagnostics.push({index,result:'unreadable'});
          // Ignore incomplete or duplicate streaming groups.
        }
      }
      if (matchedVideos.length !== 1) {
        await fs.writeFile(path.join(outputDir, `${shortcode}-capture-diagnostic.json`), JSON.stringify({source:sourceEvidence,streams:diagnostics},null,2));
        throw new Error(`Captured media cannot be uniquely matched to the visible source video (${matchedVideos.length} matches); refusing unrelated media; inspect ${shortcode}-capture-diagnostic.json`);
      }
      videoInput = matchedVideos[0].path;
      audioInput = matchedVideos[0].hasAudio ? videoInput : matchedAudio.length === 1 ? matchedAudio[0] : "";
      if (!audioInput) throw new Error("No unambiguous matching audio stream; refusing silent or unrelated audio");
      if (!videoInput) throw new Error("Captured Instagram fragments did not contain a complete video stream.");
      const ffmpegArgs = ["-y", "-i", videoInput];
      if (audioInput) ffmpegArgs.push("-i", audioInput);
      ffmpegArgs.push("-map", "0:v:0");
      if (audioInput) ffmpegArgs.push("-map", "1:a:0");
      ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
      if (audioInput) ffmpegArgs.push("-c:a", "aac");
      else ffmpegArgs.push("-an");
      ffmpegArgs.push("-shortest");
      ffmpegArgs.push("-movflags", "+faststart", destination);
      await execFileAsync("ffmpeg", ffmpegArgs);

      const { stdout: probeOutput } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,duration:format=duration",
        "-of", "json", destination
      ]);
      const probe = JSON.parse(probeOutput);
      const encodedVideo = probe.streams?.find((stream) => stream.codec_type === "video");
      const encodedAudio = probe.streams?.find((stream) => stream.codec_type === "audio");
      const duration = Number(probe.format?.duration || 0);
      if (!encodedVideo || encodedVideo.codec_name !== "h264" || encodedVideo.width !== sourceEvidence.width || encodedVideo.height !== sourceEvidence.height) {
        throw new Error("Rendered mirror failed the required original-dimension H.264 validation.");
      }
      if (audioInput && (!encodedAudio || encodedAudio.codec_name !== "aac")) {
        throw new Error("Rendered mirror failed the required AAC audio validation.");
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Rendered mirror has no valid playable duration.");
      }
      if (Math.abs(duration - sourceEvidence.duration) > 1) throw new Error("Output duration does not match the caption's source video");
      for (const stream of [encodedVideo,encodedAudio]) {
        if (!Number.isFinite(Number(stream?.duration)) || Math.abs(Number(stream.duration) - sourceEvidence.duration) > 1) throw new Error('Decoded video/audio duration is incomplete; refusing a partial capture');
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    const resultStat = await fs.stat(destination);
    const evidence = { ...sourceEvidence, shortcode, destination, bytes: resultStat.size, captured_at: new Date().toISOString(), media_match_method: "unique-complete-stream-duration-dimensions-v1" };
    await fs.writeFile(path.join(outputDir, `${shortcode}.json`), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ shortcode, destination, bytes: resultStat.size, audioCaptured: Boolean(audioInput), logoOverlay: null, source: reelUrl }));
    return evidence;
  } finally {
    await context.close();
  }
}

export { capture, launch };
if (import.meta.url === `file://${process.argv[1]}`) {
 const [command,url]=process.argv.slice(2);
 if(command==='login') await login();
 else if(command==='capture') await capture(url);
 else throw new Error('Usage: capture.mjs <login|capture> [source URL]');
}
