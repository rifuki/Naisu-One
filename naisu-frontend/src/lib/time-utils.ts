/**
 * Format a timestamp to a relative time string
 * Examples: "just now", "2 min ago", "1 hour ago", "yesterday", "Mar 19"
 */
export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return 'just now';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  // Less than 1 minute
  if (diff < 60000) {
    return 'just now';
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} min ago`;
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  
  // Less than 48 hours
  if (diff < 172800000) {
    return 'yesterday';
  }
  
  // Otherwise show date
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format timestamp to absolute time
 * Example: "2:30 PM" or "Mar 19, 2:30 PM"
 */
export function formatAbsoluteTime(timestamp: number | undefined): string {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const timeString = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  
  if (isToday) {
    return timeString;
  }
  
  const dateString = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  
  return `${dateString}, ${timeString}`;
}
