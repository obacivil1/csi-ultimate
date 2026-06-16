import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AppShell } from "@/components/layout/app-shell"
import { ErrorBoundary } from "@/components/error-boundary"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "CSI-Ultimate Enterprise",
  description: "Enterprise intelligence platform",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider defaultTheme="light" storageKey="csi-theme">
          <AppShell>
            <ErrorBoundary>{children}</ErrorBoundary>
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}
