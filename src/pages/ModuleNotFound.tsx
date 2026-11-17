// ModuleNotFound — graceful fallback for unknown module ids and 404 routes.

import { Link } from 'react-router-dom'

export function ModuleNotFound({ id }: { id?: string }) {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
      <p className="font-medium">Module not found{id ? `: “${id}”` : ''}</p>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        There is no module with that id. Modules are discovered automatically.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
      >
        Back to modules
      </Link>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
      <p className="font-medium">Page not found</p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
      >
        Back to modules
      </Link>
    </div>
  )
}
