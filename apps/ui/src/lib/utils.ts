import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/Radix components under `@/components/ui` compose classNames through this. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
