export const PHONE_QUERY = "(pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 599px)"

export const isPhone = () => matchMedia(PHONE_QUERY).matches
