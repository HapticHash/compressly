import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps {
  wrapperClassName?: string;
  className?: string;
  children?: ReactNode;
  // Everything else (id, value, onChange, aria-*) goes to the <select>.
  [prop: string]: unknown;
}

/**
 * Native <select> with its own chevron. The browser's arrow sits flush against
 * the right edge, so it's hidden (appearance-none) and replaced by an icon
 * with room around it.
 */
export function Select({ className = "", wrapperClassName = "", children, ...props }: SelectProps) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        {...props}
        className={`w-full appearance-none cursor-pointer pl-3 pr-10 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
      />
    </div>
  );
}
