// App — shell layout + routes (PLAN.md §4): module navigation on the left,
// routed pages in the main area. Below 1280px the navigation becomes a strip
// across the top and panels stack.

import { Route, Routes } from 'react-router-dom'
import { Sidebar } from '@shell/Sidebar'
import { ModuleListPage } from './pages/ModuleListPage'
import { ModuleHomePage } from './pages/ModuleHomePage'
import { ViewerPage } from './pages/ViewerPage'
import { NotFoundPage } from './pages/ModuleNotFound'
import { PrimitivesPage } from './pages/PrimitivesPage'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink xl:flex-row">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-pen px-3 py-2 text-pen-ink focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 xl:h-screen xl:overflow-y-auto">
        <Routes>
          <Route path="/" element={<ModuleListPage />} />
          <Route path="/modules/:id" element={<ModuleHomePage />} />
          <Route path="/modules/:id/view" element={<ViewerPage />} />
          <Route path="/primitives" element={<PrimitivesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  )
}
