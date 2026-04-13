import { useEffect, useState } from "react";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export default function usePersistedState(key, initialState) {
  const [initialValue] = useState(() => cloneValue(initialState));

  const [state, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return cloneValue(initialValue);
      return { ...cloneValue(initialValue), ...JSON.parse(raw) };
    } catch {
      return cloneValue(initialValue);
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage write failures.
    }
  }, [key, state]);

  const resetState = () => {
    const fresh = cloneValue(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage remove failures.
    }
    setState(fresh);
  };

  return [state, setState, resetState];
}
