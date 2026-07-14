// Orchestrates which classifier model is active in the offscreen document and
// handles switching between them when the user changes the "Trained model"
// setting.
//
// Two properties matter and are the reason this is a separate, dependency-free
// unit (so they can be tested without chrome/tf/nsfwjs):
//
//  1. No gap. The currently-active model keeps serving predictions the whole
//     time a new model is loading. `onReady` (which swaps the live model) only
//     fires once the replacement is actually loaded. There is never a window
//     with no model, so an in-flight image is never answered "safe" just
//     because a switch was underway — previously-blocked content stays blocked
//     until the new model has re-processed it.
//  2. Convergence. `select()` is safe to call repeatedly and mid-load. Only one
//     load runs at a time; if the desired model changes while a load is in
//     flight, the controller re-checks on completion and loads the newest
//     choice. This also closes the cold-start race where the offscreen kicks
//     off a load with the default model before the stored choice arrives.

export type ModelControllerOptions<M> = {
  // Load and build the model for `id`. Rejects to trigger a retry.
  loadFn: (id: string) => Promise<M>
  // Called once a newly-loaded model should become the live one. The offscreen
  // swaps its model/queue here; the previous model stays live until this fires.
  onReady: (model: M, id: string) => void
  // Called when loading `id` has failed maxAttempts times in a row.
  onError?: (error: Error, id: string) => void
  maxAttempts?: number
  // Schedules a retry after a failed load. Default backs off ~200ms; tests
  // inject a synchronous scheduler.
  scheduleRetry?: (retry: () => void) => void
}

export class ModelController<M> {
  private activeId: string | null = null
  private desiredId: string | null = null
  private loading = false
  private attempts = 0

  private readonly loadFn: (id: string) => Promise<M>
  private readonly onReady: (model: M, id: string) => void
  private readonly onError: ((error: Error, id: string) => void) | undefined
  private readonly maxAttempts: number
  private readonly scheduleRetry: (retry: () => void) => void

  constructor (options: ModelControllerOptions<M>) {
    this.loadFn = options.loadFn
    this.onReady = options.onReady
    this.onError = options.onError
    this.maxAttempts = options.maxAttempts ?? 5
    this.scheduleRetry = options.scheduleRetry ?? ((retry) => { setTimeout(retry, 200) })
  }

  // The model id currently serving predictions (null until the first load).
  public get loaded (): string | null {
    return this.activeId
  }

  public get isLoading (): boolean {
    return this.loading
  }

  // Request that `id` become the active model. If it is already active (or
  // already loading and unchanged) this is a no-op, so callers can fire it on
  // every settings update without churn.
  public select (id: string): void {
    if (id === this.desiredId && (this.activeId === id || this.loading)) return
    this.desiredId = id
    this.ensure()
  }

  private ensure (): void {
    if (this.loading) return
    if (this.desiredId === null) return
    if (this.desiredId === this.activeId) return
    this.startLoad(this.desiredId)
  }

  private startLoad (id: string): void {
    this.loading = true
    this.loadFn(id)
      .then((model) => {
        this.loading = false
        this.attempts = 0
        this.activeId = id
        this.onReady(model, id)
        // Desired may have changed while this load was in flight.
        this.ensure()
      })
      .catch((error: Error) => {
        this.loading = false
        this.attempts += 1
        // activeId is unchanged, so a previously-loaded model keeps serving.
        if (this.attempts < this.maxAttempts) {
          this.scheduleRetry(() => { this.ensure() })
        } else {
          this.attempts = 0
          if (this.onError !== undefined) this.onError(error, id)
        }
      })
  }
}
