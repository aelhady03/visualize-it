// App — shell layout + routes (PLAN.md §4): sidebar on the left, routed
// pages in the main area. Below ~1280px the sidebar collapses to a
// horizontal strip and panels stack.

import { Route, Routes } from 'react-router-dom'
import { Sidebar } from '@shell/Sidebar'
import { ModuleListPage } from './pages/ModuleListPage'
import { ModuleHomePage } from './pages/ModuleHomePage'
import { ViewerPage } from './pages/ViewerPage'
import { NotFoundPage } from './pages/ModuleNotFound'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 xl:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6 xl:h-screen xl:overflow-y-auto">
        <Routes>
          <Route path="/" element={<ModuleListPage />} />
          <Route path="/modules/:id" element={<ModuleHomePage />} />
          <Route path="/modules/:id/view" element={<ViewerPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  )
}
