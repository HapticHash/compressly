import { memo } from "react";
import { motion } from "motion/react";
import {
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  Image as ImageIcon,
  Video,
} from "lucide-react";

const BADGE_CLASS =
  "absolute flex-col items-center justify-center w-20 h-24 bg-surface/80 shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0";
const LABEL_CLASS =
  "text-[10px] font-bold text-text-muted uppercase tracking-wider";

const BADGES = [
  { Icon: FileText, color: "text-red-400", label: "PDF", position: "top-24 left-[8%] hidden lg:flex", from: { y: 20, rotate: -12 }, rotate: -10 },
  { Icon: ImageIcon, color: "text-blue-400", label: "JPG", position: "top-32 right-[10%] hidden lg:flex", from: { y: -20, rotate: 15 }, rotate: 12 },
  { Icon: FileCode, color: "text-orange-400", label: "SVG", position: "top-72 left-[15%] hidden xl:flex", from: { x: -20, rotate: -5 }, rotate: -8 },
  { Icon: Video, color: "text-purple-400", label: "MP4", position: "top-64 right-[18%] hidden xl:flex", from: { x: 20, rotate: 8 }, rotate: 10 },
  { Icon: FileImage, color: "text-emerald-400", label: "PNG", position: "top-[28rem] left-[12%] hidden 2xl:flex", from: { y: 20, rotate: 20 }, rotate: 18 },
  { Icon: FileAudio, color: "text-pink-400", label: "MP3", position: "top-[26rem] right-[15%] hidden 2xl:flex", from: { y: -15, rotate: -15 }, rotate: -12 },
];

// Memoized: purely decorative, never needs to re-render with app state.
export const FloatingBadges = memo(function FloatingBadges() {
  return (
    <>
      {BADGES.map(({ Icon, color, label, position, from, rotate }, i) => (
        <motion.div
          key={label}
          aria-hidden="true"
          initial={{ opacity: 0, ...from }}
          animate={{ opacity: 1, x: 0, y: 0, rotate }}
          transition={{ duration: 1, delay: i * 0.2, ease: "easeOut" }}
          className={`${BADGE_CLASS} ${position}`}
        >
          <Icon className={`w-8 h-8 ${color} mb-2`} />
          <span className={LABEL_CLASS}>{label}</span>
        </motion.div>
      ))}
    </>
  );
});
