import { ReactNode } from "react";

export default function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={["bg-bg-card rounded-card-lg border border-line shadow-md", className].join(" ")}>
      {children}
    </div>
  );
}
