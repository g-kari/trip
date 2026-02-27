import { useEffect } from 'react'

/**
 * Adds scroll-triggered fade-in animation to elements with [data-reveal] attribute.
 * Uses IntersectionObserver for performance.
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

    // Observe all elements with data-reveal attribute
    const elements = document.querySelectorAll('[data-reveal]')
    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [enabled])
}
