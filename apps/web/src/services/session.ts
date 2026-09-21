const SESSION_USER_ID_KEY = 'stock-trading-simulator:userId'

export const loadSessionUserId = () => localStorage.getItem(SESSION_USER_ID_KEY)
export const saveSessionUserId = (userId: string) => localStorage.setItem(SESSION_USER_ID_KEY, userId)
export const clearSessionUserId = () => localStorage.removeItem(SESSION_USER_ID_KEY)
