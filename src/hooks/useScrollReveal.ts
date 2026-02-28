import { useEffect } from 'react'

/**
 * Adds scroll-triggered fade-in animation to elements with [data-reveal] attribute.
 * Uses IntersectionObserver for performance.
 * Uses MutationObserver to pick up dynamically added elements.
 */
export function useScrollReveal(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).classList.add('revealed')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )

    // Observe all existing elements with data-reveal attribute
    const elements = document.querySelectorAll('[data-reveal]')
    elements.forEach((el) => observer.observe(el))

    // Watch for dynamically added [data-reveal] elements
    const mutation = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.hasAttribute('data-reveal')) {
            observer.observe(node)
          }
          node.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el))
        }
      }
    })
    mutation.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutation.disconnect()
    }
  }, [enabled])
}
