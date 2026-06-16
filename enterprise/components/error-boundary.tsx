"use client"

import { Component, type ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="p-6">
          <Card>
            <CardContent className="py-16 text-center">
              <div className="p-3 rounded-full bg-rose-500/10 w-fit mx-auto mb-4">
                <AlertTriangle className="h-8 w-8 text-rose-400" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
              <p className="text-muted-foreground mb-2 text-sm max-w-md mx-auto">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <Button onClick={() => this.setState({ hasError: false })}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }
    return this.props.children
  }
}
