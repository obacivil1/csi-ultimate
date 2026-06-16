"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function NewCrawlRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/crawl-studio")
  }, [router])

  return null
}
