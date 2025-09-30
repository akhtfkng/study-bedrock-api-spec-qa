import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "API Spec QA Agent (PoC)",
  description: "Minimal OpenAPI question answering demo"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
