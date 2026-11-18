// ModuleNotFound — fallback for unknown module ids and 404 routes. Says what
// was not found and offers the one useful next step.

import { Link } from 'react-router-dom'

const BUTTON_CLASS =
  'mt-5 inline-flex h-10 items-center rounded-md bg-pen px-4 text-[0.9375rem] font-[600] text-pen-ink transition-[filter] hover:brightness-110'

export function ModuleNotFound({ id }: { id?: string }) {
  return (
    <div className="mx-auto max-w-3xl rounded-[10px] border border-dashed border-rule px-6 py-10">
      <p className="text-[1.25rem] font-[680]">
        {id ? (
          <>
            There is no module called <span className="voice-printed">{id}</span>
          </>
        ) : (
          'There is no module at this address'
        )}
      </p>
      <p className="mt-2 max-w-[56ch] text-ink-soft">
        Check the address for a typo, or pick a module from the list. Module ids are the folder
        names under <span className="voice-printed">src/modules/</span>.
      </p>
      <Link to="/" className={BUTTON_CLASS}>
        See all modules
      </Link>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl rounded-[10px] border border-dashed border-rule px-6 py-10">
      <p className="text-[1.25rem] font-[680]">Nothing lives at this address</p>
      <p className="mt-2 text-ink-soft">The modules are all on the home page.</p>
      <Link to="/" className={BUTTON_CLASS}>
        See all modules
      </Link>
    </div>
  )
}
