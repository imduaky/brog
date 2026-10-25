import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

/** Mutation that toasts errors and refreshes all admin queries afterwards. */
export function useAdminMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, success?: string | ((r: TResult) => string)) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (success) toast.success(typeof success === 'function' ? success(r) : success)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}
