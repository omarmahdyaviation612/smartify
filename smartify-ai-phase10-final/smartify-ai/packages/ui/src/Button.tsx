import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ai" | "ghost";

const variantClasses: Record<Variant, string> = {
  primary: "bg-sf-blue-500 text-white hover:bg-sf-blue-600",
  secondary: "bg-white text-navy-900 border border-neutral-300 hover:bg-neutral-50",
  ai: "bg-ai-gradient text-white shadow-[0_8px_24px_rgba(124,58,237,0.18)]",
  ghost: "bg-transparent text-navy-900 hover:bg-neutral-100",
};

export interface SmartifyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/** Minimal shared button primitive. Extend with more variants only as real screens need them. */
export function SmartifyButton({ variant = "primary", className = "", children, ...props }: SmartifyButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-sf px-6 py-3 text-base font-semibold transition-colors duration-200 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
