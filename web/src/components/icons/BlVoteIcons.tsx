interface IconProps {
  size?: number
  className?: string
}

export function BlUpvoteIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <g fill="none">
        <path
          fill="currentColor"
          fillOpacity=".16"
          d="M7.895 7.69c-.294.3-.598.534-.895.71v12.334l8.509 1.223a4.1 4.1 0 0 0 2.82-.616a4.26 4.26 0 0 0 1.756-2.335l1.763-5.753a3.48 3.48 0 0 0-.497-3.04a3.36 3.36 0 0 0-1.183-1.023a3.3 3.3 0 0 0-1.509-.367h-3.633a9.7 9.7 0 0 0 .496-1.706a9 9 0 0 0 .164-1.706c0-.904-.352-1.772-.979-2.412C14.081 2.36 13.231 2 12.345 2s-1.736.36-2.362 1a3.45 3.45 0 0 0-.979 2.411c0 .597-.324 1.478-1.109 2.28"
        />
        <path
          stroke="currentColor"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          strokeWidth="1.5"
          d="M7.895 7.69c-.294.3-.598.534-.895.71v12.334l8.509 1.223a4.1 4.1 0 0 0 2.82-.616a4.26 4.26 0 0 0 1.756-2.335l1.763-5.753a3.48 3.48 0 0 0-.497-3.04a3.36 3.36 0 0 0-1.183-1.023a3.3 3.3 0 0 0-1.509-.367h-3.633a9.7 9.7 0 0 0 .496-1.706a9 9 0 0 0 .164-1.706c0-.904-.352-1.772-.979-2.412C14.081 2.36 13.231 2 12.345 2s-1.736.36-2.362 1a3.45 3.45 0 0 0-.979 2.411c0 .597-.324 1.478-1.109 2.28ZM6.2 7H2.8a.8.8 0 0 0-.8.8v13.4a.8.8 0 0 0 .8.8h3.4a.8.8 0 0 0 .8-.8V7.8a.8.8 0 0 0-.8-.8Z"
        />
      </g>
    </svg>
  )
}

export function BlDownvoteIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <g fill="none">
        <path
          fill="currentColor"
          fillOpacity=".16"
          d="M7.895 16.31A4.4 4.4 0 0 0 7 15.6V3.266l8.509-1.223a4.1 4.1 0 0 1 2.82.616a4.25 4.25 0 0 1 1.756 2.335l1.763 5.753a3.48 3.48 0 0 1-.497 3.04c-.31.43-.716.781-1.183 1.023a3.3 3.3 0 0 1-1.509.367h-3.633q.326.83.496 1.706a9 9 0 0 1 .164 1.706c0 .904-.352 1.772-.979 2.412c-.626.64-1.476.999-2.362.999s-1.736-.36-2.362-1a3.45 3.45 0 0 1-.979-2.411c0-.598-.324-1.478-1.109-2.28"
        />
        <path
          stroke="currentColor"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          strokeWidth="1.5"
          d="M7.895 16.31A4.4 4.4 0 0 0 7 15.6V3.266l8.509-1.223a4.1 4.1 0 0 1 2.82.616a4.25 4.25 0 0 1 1.756 2.335l1.763 5.753a3.48 3.48 0 0 1-.497 3.04c-.31.43-.716.781-1.183 1.023a3.3 3.3 0 0 1-1.509.367h-3.633q.326.83.496 1.706a9 9 0 0 1 .164 1.706c0 .904-.352 1.772-.979 2.412c-.626.64-1.476.999-2.362.999s-1.736-.36-2.362-1a3.45 3.45 0 0 1-.979-2.411c0-.598-.324-1.478-1.109-2.28ZM6.2 17H2.8a.8.8 0 0 1-.8-.8V2.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8v13.4a.8.8 0 0 1-.8.8Z"
        />
      </g>
    </svg>
  )
}

export function BlReportIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <mask id="bl-report-mask">
          <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
            <path fill="#555" d="M36 35H12V21c0-6.627 5.373-12 12-12s12 5.373 12 12z" />
            <path strokeLinecap="round" d="M8 42h32M4 13l3 1m6-10l1 3m-4 3L7 7" />
          </g>
        </mask>
      </defs>
      <path fill="currentColor" d="M0 0h48v48H0z" mask="url(#bl-report-mask)" />
    </svg>
  )
}
