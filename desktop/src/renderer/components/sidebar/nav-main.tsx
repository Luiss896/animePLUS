import {
  Bookmark,
  CalendarClock,
  History,
  Home,
  type LucideIcon,
  PartyPopper,
  Search,
  Settings,
} from "lucide-react";
import React from "react";
import { Link, useLocation } from "react-router-dom";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/renderer/components/ui/sidebar";
import { cn } from "@/renderer/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

const navbarItems: NavItem[] = [
  {
    title: "Home",
    href: "/",
    icon: Home,
  },
  {
    title: "Search",
    href: "/search",
    icon: Search,
  },
  {
    title: "Bookmarks",
    href: "/bookmarks",
    icon: Bookmark,
  },
  {
    title: "History",
    href: "/history",
    icon: History,
  },
  {
    title: "Following",
    href: "/following",
    icon: CalendarClock,
  },
  {
    title: "Watch party",
    href: "/party",
    icon: PartyPopper,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function NavMain() {
  const location = useLocation();

  const renderNavItem = (item: NavItem) => {
    const isActive = location.pathname === item.href;

    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={item.title}
          /*
           * Active state is carried by a palette-coloured rail plus a tinted
           * background, so the current section is obvious at a glance instead of
           * relying on a barely-visible shade change. The rail is drawn with a
           * pseudo-element-free inner span to keep it inside the button's own
           * rounded shape and transition.
           */
          className={cn(
            "oa-nav-item group/nav relative overflow-hidden rounded-lg transition-colors",
            isActive
              ? "bg-accent-soft/60 text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          <Link to={item.href} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-glow transition-all duration-200",
                isActive ? "opacity-100" : "scale-y-0 opacity-0 group-hover/nav:scale-y-50 group-hover/nav:opacity-60"
              )}
            />
            <item.icon
              className={cn(
                "transition-transform duration-200 group-hover/nav:scale-110",
                isActive && "text-accent-glow"
              )}
            />
            <span className={cn(isActive && "font-medium")}>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <SidebarGroup>
      <SidebarMenu>{navbarItems.map((item) => renderNavItem(item))}</SidebarMenu>
    </SidebarGroup>
  );
}
