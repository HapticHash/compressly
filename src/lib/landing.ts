// Landing pages for common searches. Each one gets its own static HTML at
// build time (see vite.config.ts) and opens the app with a preset applied.
import type { StoredSettings } from "../hooks/useSettings";

export type LandingPreset = Partial<Omit<StoredSettings, "image" | "video">> & {
  image?: Partial<StoredSettings["image"]>;
  video?: Partial<StoredSettings["video"]>;
};

export interface LandingPage {
  slug: string;
  /** <title> and og:title */
  title: string;
  description: string;
  heading: string;
  intro: string;
  preset: LandingPreset;
}

export const LANDING_PAGES: LandingPage[] = [
  {
    slug: "compress-pdf-to-100kb",
    title: "Compress PDF to 100 KB – Free & Private | Compressly",
    description: "Shrink a PDF to under 100 KB for online forms and applications. Runs in your browser, so your document is never uploaded.",
    heading: "Compress PDF to 100 KB",
    intro: "Most application portals cap uploads at 100 KB. Drop your PDF and Compressly shrinks it under the limit, right on your device.",
    preset: { level: "Custom", targetValue: "100", targetUnit: "KB", pdfMode: "smallest" },
  },
  {
    slug: "compress-pdf",
    title: "Compress PDF Online, Keep Text Selectable | Compressly",
    description: "Reduce PDF file size while keeping text searchable and links working. Free, private, and nothing is uploaded.",
    heading: "Compress PDF, keep the text",
    intro: "Compressly re-compresses the images inside your PDF and leaves the text, links and layout alone.",
    preset: { level: "Medium", pdfMode: "keep-text" },
  },
  {
    slug: "compress-video-for-whatsapp",
    title: "Compress Video for WhatsApp (16 MB) | Compressly",
    description: "Make videos small enough to send on WhatsApp. Compressed in your browser, never uploaded to a server.",
    heading: "Compress video for WhatsApp",
    intro: "WhatsApp limits videos to 16 MB. Drop a clip and Compressly fits it under the limit at the best quality it can.",
    preset: { level: "Custom", targetValue: "16", targetUnit: "MB", video: { format: "mp4" } },
  },
  {
    slug: "compress-video-for-discord",
    title: "Compress Video for Discord (10 MB) | Compressly",
    description: "Shrink videos under Discord's 10 MB upload limit without Nitro. Private, in-browser compression.",
    heading: "Compress video for Discord",
    intro: "Discord's free upload limit is 10 MB. Compressly squeezes your clip under it without leaving your device.",
    preset: { level: "Custom", targetValue: "10", targetUnit: "MB", video: { format: "mp4" } },
  },
  {
    slug: "compress-image-to-50kb",
    title: "Compress Image to 50 KB for Passport & Forms | Compressly",
    description: "Reduce a photo to under 50 KB for passport, visa and exam application forms. Free and private.",
    heading: "Compress image to 50 KB",
    intro: "Government and exam portals often require photos under 50 KB. Compressly gets your JPG there in seconds.",
    preset: { level: "Custom", targetValue: "50", targetUnit: "KB", image: { format: "jpeg" } },
  },
  {
    slug: "compress-image-to-100kb",
    title: "Compress Image to 100 KB | Compressly",
    description: "Reduce JPG, PNG or HEIC photos to under 100 KB. Runs entirely in your browser.",
    heading: "Compress image to 100 KB",
    intro: "Drop any photo and Compressly brings it under 100 KB, keeping as much detail as possible.",
    preset: { level: "Custom", targetValue: "100", targetUnit: "KB", image: { format: "jpeg" } },
  },
  {
    slug: "heic-to-jpg",
    title: "Convert HEIC to JPG – iPhone Photos | Compressly",
    description: "Convert iPhone HEIC photos to JPG that open everywhere. Private, in-browser conversion.",
    heading: "Convert HEIC to JPG",
    intro: "iPhones save photos as HEIC, which many sites reject. Convert them to JPG without uploading them anywhere.",
    preset: { level: "Low", image: { format: "jpeg" } },
  },
  {
    slug: "convert-image-to-webp",
    title: "Convert Images to WebP | Compressly",
    description: "Convert JPG and PNG images to WebP for smaller, faster web pages. Free and private.",
    heading: "Convert images to WebP",
    intro: "WebP files are typically 25–50% smaller than JPG or PNG at the same quality.",
    preset: { level: "Medium", image: { format: "webp" } },
  },
  {
    slug: "compress-gif",
    title: "Compress GIF – Keep the Animation | Compressly",
    description: "Reduce animated GIF file size without losing frames. Private, in-browser compression.",
    heading: "Compress GIF",
    intro: "Shrink animated GIFs for chats and docs while keeping every frame.",
    preset: { level: "Medium" },
  },
  {
    slug: "video-to-gif",
    title: "Convert Video to GIF | Compressly",
    description: "Turn short videos into animated GIFs right in your browser. Nothing is uploaded.",
    heading: "Convert video to GIF",
    intro: "Drop a short clip and get a looping GIF. Use the trim options to pick the moment you want.",
    preset: { level: "Medium", video: { format: "gif", resolution: 480 } },
  },
  {
    slug: "compress-mp3",
    title: "Compress MP3 & Audio Files | Compressly",
    description: "Reduce the size of MP3, WAV and other audio files. Free, private, in your browser.",
    heading: "Compress audio",
    intro: "Shrink podcasts, voice notes and music files to share them more easily.",
    preset: { level: "Medium" },
  },
];

export function getLandingPage(pathname: string): LandingPage | undefined {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  return LANDING_PAGES.find((page) => page.slug === slug);
}
