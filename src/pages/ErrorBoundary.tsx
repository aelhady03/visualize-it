// ErrorBoundary — catches module load failures (unknown ids, broken modules)
// so pages degrade gracefully instead of crashing the app.

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  fallback: ReactNode
  children?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Module page failed to load:', error, info.componentStack)
  }

  render() {
    if (this.state.error) return this.props.fallback
    return this.props.children
  }
}
