import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

const FeedsAddForm = createContext<ReactNode>(null)
const SetFeedsAddForm = createContext<(node: ReactNode) => void>(() => {})

export function useFeedsAddForm() {
  return useContext(FeedsAddForm)
}

export function useSetFeedsAddForm() {
  return useContext(SetFeedsAddForm)
}

export function FeedsAddFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<ReactNode>(null)
  return (
    <SetFeedsAddForm.Provider value={setForm}>
      <FeedsAddForm.Provider value={form}>{children}</FeedsAddForm.Provider>
    </SetFeedsAddForm.Provider>
  )
}
