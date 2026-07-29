import type { SettingGuidesCatalog } from './types'

/**
 * English setting guides (plain language + what connects to what)
 * Structure: what it is → what it affects → where to see / how to verify → pitfalls
 */
export const en: SettingGuidesCatalog = {
  ui: {
    siteUrl: {
      what: 'The public address people use to open your site, like https://your-domain.',
      chain:
        '1) Change it here and save — it applies right away (you don’t need the bottom “Save configuration” button).\n2) After that, every full address the site reports to the outside world uses the new one: where GitHub/Google login sends people back, how other sites recognize you, share links, and so on.\n3) The system also lists “what to re-check after a domain change” — go through that list item by item.',
      frontend:
        'After changing it, try this: sign out, use a third-party login, and see whether you land back on this site cleanly.\nShare links and connections with other sites also follow the new address. Page colors and themes do not change by themselves.',
      notes:
        'When the domain changes, the “return address” registered at login services (GitHub and the like) usually needs updating too, or login will fail.\nCertificates and domain DNS must match what you put here. When unsure, follow the checklist the system shows.',
    },
    siteMetadata: {
      what: 'Your site’s public name card: name, one-line intro, and small icon.',
      chain:
        '1) After editing, click “Save configuration” at the bottom of the page.\n2) Once saved, the browser tab, site name near the login area, and the short blurb when shared all use the new content.\n3) This is separate from “Site address” above: here you only change the name card, not how people reach you.',
      frontend:
        'Name and icon on the browser tab, site name on the login page, and the preview blurb when you paste the link into chat apps.\nAfter saving, force-refresh (Ctrl/Cmd+Shift+R) to see whether the icon updated.',
      notes:
        'The icon can be a web image URL or a small local upload (keep it small).\nIf the icon doesn’t change right away, the browser is usually still remembering the old one.',
    },
    siteTitle: {
      what: 'The site’s display name (the short name people see).',
      chain:
        '1) Change the name → save at the bottom.\n2) Anywhere that shows “what this site is called” updates, such as the tab title.\n3) Does not change the domain or login return addresses.',
      frontend: 'Browser tab title, site name on the login page, and similar labels. After save and refresh you should see it immediately.',
      notes: 'Keep it short and easy to recognize; don’t write a long sentence.',
    },
    siteDescription: {
      what: 'One or two sentences explaining what this site is for.',
      chain:
        '1) Fill it in → save at the bottom.\n2) Share links and some previews will carry this text.\n3) Does not change navigation or permissions.',
      frontend: 'The short blurb that sometimes appears when you paste the URL into chat or social apps.',
      notes: 'If you write too much, outside apps only show the first lines anyway — one or two sentences is enough.',
    },
    siteFavicon: {
      what: 'The small icon on the browser tab.',
      chain:
        '1) Paste a link or upload → save at the bottom.\n2) The browser shows the new icon next time (sometimes it still shows the old one first).\n3) Unrelated to wallpaper or theme colors.',
      frontend: 'The little image on the tab corner and in bookmarks. After changing it, hard-refresh or try a private window.',
      notes: 'For local upload, pick a small image; very large files may fail to upload.',
    },
    siteFooter: {
      what: 'The bar at the very bottom of the page: filing numbers, cloud-provider badges, and similar.',
      chain:
        '1) Put filing numbers and sponsor badges here → save at the bottom.\n2) The bottom of every page on the site updates together.\n3) Display only for visitors — it does not really change your acceleration routes or server network.',
      frontend: 'Scroll to the bottom of any page to see it. If everything is empty, that block may not show at all.',
      notes: 'If you have no filing number, leave it blank — don’t invent someone else’s.',
    },
    siteIcp: {
      what: 'ICP filing number from the regulator (fill only if you have one).',
      chain:
        '1) Enter the number → save at the bottom.\n2) The footer gains a filing line; empty means hidden.\n3) Unrelated to whether the site can be visited — compliance display only.',
      frontend: 'Filing text in the footer. Visible after save and refresh.',
      notes: 'Leave empty if you have none.',
    },
    siteGongan: {
      what: 'Public-security filing number (fill only if you have one).',
      chain:
        '1) Enter the number → save → it shows in the footer.\n2) Empty means hidden.\n3) Can appear together with ICP, or only one of them.',
      frontend: 'The public-security filing line in the footer.',
      notes: 'Leave empty if you have none.',
    },
    cloudSponsors: {
      what: 'Whether the footer shows small logos for certain cloud providers.',
      chain:
        '1) Check the ones you want → save at the bottom.\n2) The footer gains a row of small icons.\n3) Unrelated to whether you actually use those services — pure display.',
      frontend: 'Sponsor / cloud badges in the footer. Unchecked means no badge row.',
      notes: 'You can select none; don’t treat this as “that cloud service is already set up.”',
    },
    backgroundAndTheme: {
      what: 'Site-wide background, background blur, and similar atmosphere settings.',
      chain:
        '1) Change wallpaper / blur → save at the bottom.\n2) The atmosphere image behind the whole site updates together.\n3) Pairs with “Immersive effects” below: the image is set here; motion on/off is in that group.',
      frontend:
        'Wallpaper behind any page; wallpaper-related entries in the control panel.\nAfter save, switch to the home page — easiest place to notice the change.',
      notes: 'A busy or very blurry image makes text hard to read. If the site stutters, turn a few items off in the effects group first.',
    },
    wallpaper: {
      what: 'Which image is used as the background (paste an image address).',
      chain:
        '1) Paste an address that opens the image → save.\n2) Used as wallpaper across the site.\n3) Parallax and click ripples also act on this image — if the image isn’t set, motion has nothing to ride on.',
      frontend: 'Atmosphere image behind almost every page. Open a fresh home page side by side to compare.',
      notes: 'Smaller images run more smoothly; a broken link shows blank or a broken image.',
    },
    wallpaperBlur: {
      what: 'How soft versus sharp the background is.',
      chain:
        '1) Drag the value → save.\n2) Softer background usually makes cards in front easier to read.\n3) Can stack with “dynamic blur” motion — don’t max both or everything goes mushy.',
      frontend: 'Overall background softness. After changing it, check on the home page whether text on cards is clear.',
      notes: 'Very high values strain the computer; if text looks soft, lower the number.',
    },
    evocative: {
      what: 'Make a still wallpaper feel alive: follow the pointer, click ripples, and so on.',
      chain:
        '1) Toggle items here and adjust frame rate / quality → save.\n2) Only changes how pages with wallpaper move — not library or report content.\n3) The wallpaper itself is set under “Background” above; on weaker machines the system may auto-reduce effects a bit.',
      frontend: 'Home and other pages with a background. Move the mouse or click the background to feel it.',
      notes: 'If it stutters: turn off ripples first, or set frame rate to 30. Turning all motion off does not break normal use.',
    },
    evocativeEffects: {
      what: 'Separate on/off for parallax, dynamic blur, and click ripples.',
      chain:
        '1) Only the items you enable actually run.\n2) Together with wallpaper, frame rate, and ripple quality they make the motion experience.\n3) When hunting lag, turn them off one by one to find the culprit quickly.',
      frontend: 'Whether the background moves with the mouse, and whether a click makes a water ripple.',
      notes: 'All three off = still wallpaper (static blur can still stay on).',
    },
    evocativeFps: {
      what: 'How smooth motion should be: 30 saves a little power, 60 feels smoother.',
      chain:
        '1) Choose 30 or 60 → save.\n2) Only affects how fast animations refresh.\n3) Does not change business data; wallpaper and effect switches stay in other items.',
      frontend: 'How smooth wallpaper animation feels. On a laptop, try both and compare.',
      notes: 'Prefer 30 on battery or when visiting from a phone.',
    },
    evocativeRippleQuality: {
      what: 'How finely click water ripples are drawn.',
      chain:
        '1) Adjust the percentage → save.\n2) Only matters when “ripples” are on.\n3) Higher looks better and costs a bit more performance.',
      frontend: 'Ripple edges when you click the background. With ripples off, changing this shows nothing.',
      notes: 'Around 85% is usually enough; lower on weaker devices.',
    },
  },

  modules: {
    visibility: {
      what: 'Which feature doors each audience can see: everyone, signed-in users, or admins only.',
      chain:
        '1) Change a module’s visibility → save the related settings on this page.\n2) The nav bar hides or shows entries by role; people without access can’t get in even by typing the URL.\n3) This is not the same as “Permissions”: here = “can you see the door”; Permissions = “what you can do once inside.”\n4) The assistant entry still needs permissions and quota together before someone can really use it.',
      frontend:
        'Library, reading, reports, apps, assistant, and similar entries on the bottom or side nav.\nUse a private window or another account to confirm what ordinary people still see.',
      notes: 'Admins can usually still open system configuration. Remember to save, and verify with a non-admin account.',
    },
    visibilityItem: {
      what: 'Visibility range for one feature only.',
      chain:
        '1) Only this item changes; other modules stay as they are.\n2) The matching nav button and open access change together.\n3) Set to “admins only” and even normal signed-in users can’t enter.',
      frontend: 'That one nav button and page. Clicking with a normal account is the clearest check.',
      notes: 'To hide from guests but open for signed-in users, choose “signed-in users.”',
    },
    library: {
      what: 'For each library category, which platforms’ items should show.',
      chain:
        '1) Connect accounts under “Data platforms” and sync first — only then do sources and counts appear here.\n2) This is display filtering only: unchecked platforms don’t show in the library, but synced data usually still sits on the server.\n3) Report pages also use platform data, but how reports expire or regenerate is under the “Report” group below.\n4) Separate from nav “is the library visible”: visibility lets you enter; inside, sources are filtered here.',
      frontend:
        'Cards under each library category, and the shown / before-filter counts.\nAfter changing, open the matching library category and compare.',
      notes: 'If there’s no data, sync platforms first. Selecting nothing for a category can leave the list empty.',
    },
    libraryType: {
      what: 'Which sources are checked for one category (for example games or anime).',
      chain:
        '1) Filters only this category.\n2) Upstream is still each platform’s sync result.\n3) Other categories are independent and don’t affect each other.',
      frontend: 'Entries under that category tab. After changing checks, refresh the category to look.',
      notes: 'Checking none may empty this category.',
    },
    report: {
      what: 'How long a report stays valid, and whether to auto-make a new one after it expires.',
      chain:
        '1) Report content depends on: platform data already synced + “AI configuration” working + permissions/quota allowing it.\n2) With “expiry” on, reports past the day count are marked expired; with “auto regenerate” also on, they rebuild in the background when due (uses AI quota).\n3) Hiding the “Reports” entry in nav only makes it hard to click in — old reports usually remain.\n4) On failure, tasks or notifications may show a hint.',
      frontend:
        'Expiry cues on the report page, and whether content looks updated.\nOpen the report page for status, or refresh after the automatic job runs.',
      notes: 'Auto regenerate costs quota; turn on expiry first, then auto regenerate. If AI isn’t set up, it keeps failing.',
    },
    reportExpiry: {
      what: 'Whether reports are allowed to “expire.”',
      chain:
        '1) Off = the day count and auto regenerate below basically do nothing.\n2) On = expiry is judged by the day count.\n3) Does not rewrite AI or platform settings — only “is this report considered old.”',
      frontend: 'Whether reports show an expired state. After flipping the switch, open the report page to confirm.',
      notes: 'With expiry off, auto regenerate is usually also unavailable.',
    },
    reportAutoRegen: {
      what: 'Automatically generate a new report after expiry.',
      chain:
        '1) “Expiry” must be on first.\n2) When due → background queue rebuilds → needs AI and platform data both healthy.\n3) On success, the report page shows new content; on failure it may stay on the old report with an error hint.',
      frontend: 'Report content becomes new after the job finishes. Watch notifications for related task messages.',
      notes: 'Fails if AI isn’t set up or quota is used up; don’t expect “click and it’s done instantly.”',
    },
    reportExpiryDays: {
      what: 'How many days a report stays valid.',
      chain:
        '1) Counted from the day it was generated.\n2) Past the days with expiry on → marked expired; with auto regenerate on → may trigger a rebuild.\n3) Changing the number does not rebuild immediately — it only affects how future checks work.',
      frontend: 'Expiry-related cues and timing. After changing, compare with the report’s generation time.',
      notes: 'Usually 1–365 days; when you leave the field it snaps into a valid range.',
    },
    music: {
      what: 'The site’s built-in music player: on or off, and which playlist source.',
      chain:
        '1) Turn the switch on, pick a platform, fill the playlist number → save at the bottom.\n2) The player fetches the list from that music service; the control-panel player and music widgets share the same setup.\n3) Turning the switch off only hides the player — playlist settings stay.\n4) “Clear cache” only forgets the list remembered on this device, not the number you typed.\n5) If the server needs a proxy for the open internet (Advanced settings), that can affect whether songs load.',
      frontend:
        'Player in the control panel, and music-related widgets.\nOnce on, you should see a list or an error message.',
      notes: 'Playlist number must match the platform you chose; private playlists often won’t load. Change the number when you switch platforms.',
    },
    musicPlatform: {
      what: 'Whether the playlist comes from Netease Cloud Music or QQ Music.',
      chain:
        '1) Switch platform → save.\n2) Use that service’s playlist number; old cache may no longer match.\n3) Works only together with the player master switch and the playlist number.',
      frontend: 'Which service tracks and covers in the playlist come from. After switching, clear cache once, then listen again.',
      notes: 'When you switch platforms, always update the playlist number below.',
    },
    musicPlaylist: {
      what: 'Playlist number (usually the digits in the share link).',
      chain:
        '1) Fill the number + player on + save.\n2) Fetches the list from the matching platform.\n3) Only on success do you get clickable songs; failure shows that the list couldn’t load.',
      frontend: 'Playlist and current track. Open the player from the control panel to check.',
      notes: 'Private playlists and wrong IDs both fail; open the playlist in a browser first to confirm you can access it.',
    },
    musicCache: {
      what: 'Forget the playlist this device remembered, and download the list again next time.',
      chain:
        '1) Click clear.\n2) Does not change switches or IDs.\n3) Next open of the player re-requests the list (may be a bit slower, but may be fresher).',
      frontend: 'List content may refresh. Clear, then open the player right away to try.',
      notes: 'Very useful when you changed the playlist number but still hear the old list.',
    },
    hitokoto: {
      what: 'Where the “daily line” on the home page / widgets comes from.',
      chain:
        '1) Pick a source (or custom) → save.\n2) The quote widget fetches a line on its own — not AI, and not data platforms.\n3) For custom, the other site must allow your site to read it, or the browser blocks the request.',
      frontend: 'Quote / short-line widgets and similar welcome displays. After changing, refresh the home page.',
      notes: 'Custom needs the right address and field names; unrelated to assistant chat.',
    },
    hitokotoSource: {
      what: 'Built-in Chinese / English / Japanese sources, or your own endpoint.',
      chain:
        '1) Built-in → uses that public service directly.\n2) Custom → the address and field options below appear.\n3) After save, the widget fetches from the new source.',
      frontend: 'Language and style of the line change. Refresh a page that shows quotes to confirm.',
      notes: 'Custom must also have an address filled, or nothing loads.',
    },
    hitokotoCustomUrl: {
      what: 'Full web address of your custom quote source.',
      chain:
        '1) Used only when the source is “custom.”\n2) When the page opens, content is fetched from this address.\n3) Then the field names below pick out the text and author.',
      frontend: 'Which line is shown. Open the address in a browser to see whether data is there.',
      notes: 'Prefer addresses starting with https; an address only on your own computer is unreachable for outside visitors.',
    },
    hitokotoTextField: {
      what: 'In the returned data, which field is the quote body.',
      chain:
        '1) After a custom source returns data, the text is taken by this name.\n2) Wrong name → blank or odd display.\n3) Independent from the author field.',
      frontend: 'Main quote content. If empty, match the field names in the returned data and fix them.',
      notes: 'Common names include hitokoto; follow the other side’s documentation.',
    },
    hitokotoAuthorField: {
      what: 'Which field is the author or source.',
      chain:
        '1) If present, shown under the quote.\n2) Can be left empty to show only the body.\n3) Only meaningful for custom sources.',
      frontend: 'The attribution line.',
      notes: 'If the other side has no author field, leave empty.',
    },
  },

  platforms: {
    list: {
      what: 'Connect external accounts like GitHub, Steam, or Bilibili and sync their data into this site.',
      chain:
        '1) Open a platform card → follow the steps to fill account/keys → enable.\n2) After a successful sync, the library, reports, and some home cards can use that data.\n3) Drag cards left/right to set card order on the report page.\n4) “Refresh” auto-syncs on the schedule you set; each platform detail page shows and manages its data cache.\n5) If the server needs a proxy for the open internet, enable it under “Advanced,” or foreign platforms often fail.',
      frontend:
        'Library entries, report material, widgets that depend on platforms, and the data management area on each platform detail page.\nAfter enable and sync, open the library and check whether that source appears.',
      notes: 'Enabling without keys set up usually won’t sync. Fill the fields first, then flip the switch.',
    },
    autoRefresh: {
      what: 'How often to auto-pull data for platforms that are already on.',
      chain:
        '1) Turn on and pick an interval.\n2) Background syncs enabled platforms on schedule (staggered so they don’t all hit the other side at once).\n3) Library and reports look “fresher” next time you open them.\n4) With no platforms enabled, auto refresh has nothing useful to do.\n5) Too short an interval may get you temporarily limited by the other platform.',
      frontend:
        'How fresh the data feels; nav layout doesn’t change. Check update times on the corresponding platform detail page or in the library.',
      notes: 'Manual sync still works alongside this. Don’t set production intervals too short.',
    },
    platformCard: {
      what: 'Whether to enable this platform, and open it to fill connection details.',
      chain:
        '1) Fill fields first, then enable — only then does it truly join sync.\n2) Once enabled it appears in library source options and report material.\n3) After turning off, that source usually stops auto-updating (whether existing data vanishes right away depends on each module’s filters).',
      frontend: 'Whether that platform joins library/report data. After enable and sync, confirm in the library.',
      notes: 'Grayed out / can’t enable usually means required fields aren’t complete yet.',
    },
    platformFields: {
      what: 'Username, secret keys, and other connection details.',
      chain:
        '1) Follow on-page steps to copy keys from the official site → paste here → save/enable.\n2) Successful sync → downstream modules have data; wrong or expired → sync fails, library/reports may stay old or empty.\n3) Some platforms also relate to “third-party login” — the steps will say so.',
      frontend:
        'Indirect: whether data appears and whether errors show. After sync, check the library or this platform’s data management area.',
      notes: 'Don’t share secret keys with others; after rotating a key, come back and update it here.',
    },
  },

  notifications: {
    master: {
      what: 'Whether to receive the various alerts this site is set up to send.',
      chain:
        '1) With the master switch off, display styles and individual sources below no longer push to you.\n2) History usually remains — only new pushes stop.\n3) Background work may still happen; you just don’t get a pop-up or red badge.\n4) To receive alerts again: turn master on, then open the matching sources and locations.',
      frontend: 'Notification list, small red badge on nav, corner tips, system notifications. With master off, these should go quiet.',
      notes: 'Options below gray out when it’s off — that’s normal.',
    },
    island: {
      what: 'Whether to show notification-related cues in the nav control area.',
      chain:
        '1) Needs the master switch on.\n2) Also needs the matching “source” allowed, and the nav area checked under locations.\n3) Only affects the nav area — not corner tips or system notifications (those have their own switches).',
      frontend: 'Notification entry or badge on the nav control area. Try a test notification to observe.',
      notes: 'Does nothing while the master switch is off.',
    },
    toast: {
      what: 'Whether short tips pop up in a corner of the page.',
      chain:
        '1) Master switch + this channel on.\n2) Still filtered by “source” and “events” — not everything pops.\n3) Can run together with nav area and system notifications, or only one of them.',
      frontend: 'Brief tip bars that flash in a corner. If too noisy, turn this off or check fewer events.',
      notes: 'For high-volume sources, pair with event filters or you’ll get flooded.',
    },
    browser: {
      what: 'Whether to use the phone/computer’s built-in system notifications.',
      chain:
        '1) Turning on makes the browser ask “Allow notifications?”\n2) Once allowed, they may still pop when the page is in the background.\n3) Still subject to master switch, sources, and event filters.\n4) If you clicked Deny, change permission in browser settings — the site can’t reverse that alone.',
      frontend: 'System notification center. Switch to another tab and see whether they still appear.',
      notes: 'Be careful on shared/public computers.',
    },
    source: {
      what: 'Whether a whole category of sources (assistant, system, federation, and so on) notifies you.',
      chain:
        '1) Turning a source off makes its location and event settings stop applying.\n2) Only affects “alert or not” — not the feature itself (the assistant still runs).\n3) To get alerts: master on → source on → check locations and events.',
      frontend: 'Whether that category still appears in the notification list. Toggle one source and compare.',
      notes: 'To mute one category, turning off the source is more precise than the master switch.',
    },
    locations: {
      what: 'Where this kind of notification appears: list, corner tips, nav area, system notifications, and so on.',
      chain:
        '1) Master switch and this source must be on first.\n2) Checking locations only then matters.\n3) Checking none = this source is effectively muted.',
      frontend: 'The display places you checked. Check only the list if you want less interruption.',
      notes: 'System notifications also need browser permission.',
    },
    events: {
      what: 'Within this category, which concrete events should notify you.',
      chain:
        '1) Unchecked events never enter notifications even if they happen.\n2) If the source is off, everything here is inactive.\n3) Good for fine control when you only want certain successes/failures.',
      frontend: 'Kinds of content in the notification list. Unchecking a few immediately removes a class of messages.',
      notes: 'If unsure, start with everything on, then turn off what gets noisy.',
    },
  },

  ai: {
    standard: {
      what: 'The default smart setup for everyday chat, analysis, and generating reports.',
      chain:
        '1) Pick a provider, fill the secret key (and address/model if needed) → save at the bottom.\n2) Assistant chat, report generation, and smart features in some small apps use this set by default.\n3) If “Lite / High quality” is off or unusable, work falls back to this set too.\n4) Also depends on “Permissions” allowing AI use and remaining quota.\n5) If the server needs a proxy for the open internet, set it under “Advanced,” or smart services may not connect.',
      frontend:
        'Whether the assistant panel can answer normally, and whether reports can generate.\nSend one simple message in the assistant first as a connectivity test.',
      notes: 'Get Standard working first, then turn on other tiers. Don’t leak secret keys.',
    },
    lite: {
      what: 'A cheaper setup for simple, repetitive tasks (optional).',
      chain:
        '1) Turn Lite on and configure it (if the secret key is empty it borrows Standard’s).\n2) Tasks marked “lite” prefer this setup.\n3) Off → still uses Standard.\n4) Same permission and quota limits apply.',
      frontend: 'Users usually don’t see a separate page — mainly which setup simple background tasks use.',
      notes: 'Can use a different provider than Standard; safer to make sure Standard works first.',
    },
    liteEnable: {
      what: 'Whether to enable the Lite tier.',
      chain:
        '1) Off = everything falls back to Standard.\n2) On = lite tasks use the Lite setup.\n3) Turning off does not delete what you already filled in.',
      frontend: 'Indirectly affects which model is used; simple tasks can show cost/speed differences.',
      notes: 'If Standard still doesn’t work, don’t rush to enable Lite.',
    },
    pro: {
      what: 'A stronger, usually costlier tier for harder tasks.',
      chain:
        '1) When on and configured, jobs that need high quality go here.\n2) Off → falls back to Standard.\n3) Usually more expensive; same permission and quota limits.',
      frontend: 'Generation quality may be better. Compare hard questions in the assistant.',
      notes: 'Enable only when needed; not every task needs this tier.',
    },
    proEnable: {
      what: 'Whether to enable the high-quality tier.',
      chain:
        '1) Off → related tasks use Standard.\n2) On → they use the high-quality setup.\n3) Turning the switch off does not delete secret keys.',
      frontend: 'Whether a stronger model may be used.',
      notes: 'If cost matters, leave it off.',
    },
    image: {
      what: 'Which service is used to generate images.',
      chain:
        '1) Pick a provider, fill secret key and model → save.\n2) Features that support image output can then work.\n3) Permissions must also allow “AI images,” and quota must remain.\n4) Can be a different provider than text chat.',
      frontend: 'Image-related buttons and result images. On failure, check whether the hint is key, permission, or quota.',
      notes: 'Each provider writes model names differently — follow the on-page hints.',
    },
    speech: {
      what: 'Account details for cloud voice features such as read-aloud and speech recognition.',
      chain:
        '1) Fill account details correctly → save.\n2) Assistant voice and read-aloud can then connect; use the on-page test to check.\n3) Permissions must also allow the matching voice abilities.\n4) Independent from text-model configuration.',
      frontend: 'Voice input and read-aloud buttons. Click the on-page test first — simplest check.',
      notes: 'Insufficient account rights fail the test; not the same secret key set as text AI.',
    },
    provider: {
      what: 'Which smart-service company to use.',
      chain:
        '1) Switching providers changes the fields below.\n2) Requests go to that provider.\n3) After switching, re-check that secret key and model name still match.',
      frontend: 'Form fields on the settings page change; wrong setup shows errors when used.',
      notes: 'Don’t switch provider but keep another provider’s model name.',
    },
    apiKey: {
      what: 'The secret password used to connect to the smart service.',
      chain:
        '1) After you fill and save it, only the server backend uses it.\n2) Visitors never see the full secret on the page.\n3) Missing or wrong → chat and generation both fail.\n4) After rotating, the old one stops working immediately.',
      frontend: 'Error messages on failure. Send one test line in the assistant.',
      notes: 'Don’t post it in public groups or put it in public code repositories.',
    },
    baseUrl: {
      what: 'Access address of the smart service (official, or a relay you run).',
      chain:
        '1) Most people leave empty = use the official address.\n2) If you fill a relay, traffic goes through the relay.\n3) Wrong value → all models fail to connect; page look is fine.',
      frontend: 'Page appearance unchanged; failure shows up as AI unavailable.',
      notes: 'If you don’t understand relays, leave empty; a wrong fill is worse than empty.',
    },
    model: {
      what: 'The exact model name to use.',
      chain:
        '1) Decides answer style, strength, and cost.\n2) Must be a name already enabled on your account.\n3) Works only together with provider and secret key.',
      frontend: 'Differences in assistant answer quality and speed.',
      notes: 'Wrong name causes the call to fail; use the name from the provider’s console.',
    },
  },

  oauth: {
    section: {
      what: 'Let visitors sign in to this site with one click using GitHub, Google, and similar accounts.',
      chain:
        '1) First fill a correct site address under “Basic configuration” so return addresses are right.\n2) Add a login method here and follow the steps to fill the ID and secret from both sides’ dashboards.\n3) Login page shows a button → user signs in at the other site → then returns here.\n4) Whether first-time visitors auto-register is controlled by the registration-related switch.\n5) After changing the site domain, also update the return address registered at the other side’s dashboard.',
      frontend:
        'Third-party buttons on the login / register page.\nA full login attempt in a private window is the best verification.',
      notes: 'If the site address isn’t set up, you’ll see a strong warning — fix basic configuration first. Don’t leak secrets.',
    },
    allowRegister: {
      what: 'On first third-party login, whether to automatically create a new account on this site.',
      chain:
        '1) On: newcomers can enter.\n2) Off: only people already linked can sign in via third party.\n3) Separate path from manually creating accounts under “User management.”',
      frontend: 'After a new visitor clicks third-party login: do they enter the site, or get refused / asked for an existing account?',
      notes: 'Turn off if you don’t want open sign-ups; you can allow only accounts you create by hand.',
    },
    provider: {
      what: 'The concrete fill-in fields for one third-party login method.',
      chain:
        '1) Fully filled and enabled → the login page shows that brand’s button.\n2) Missing fields often mean you can’t return after clicking.\n3) Return address depends on the site address configuration.',
      frontend: 'That brand’s login button. You can test one provider alone.',
      notes: 'Follow the on-page steps; avoid extra spaces when pasting.',
    },
  },

  permissions: {
    agentPreset: {
      what: 'One-click common combinations of “what the assistant / small apps may do.”',
      chain:
        '1) Clicking a preset bulk-changes many abilities below (chat, analysis, outbound network, schedules, and so on).\n2) After save, small apps and the assistant allow or deny those abilities at runtime.\n3) Whether you “see the assistant” in nav is under module settings; here is “once you see it, can you really use it.”\n4) How many times you can use it is still limited by “quota” below.\n5) After you manually change single items, it may show as “Custom.”',
      frontend:
        'Whether assistant features work, and whether smart/networked actions in small apps are refused.\nLog in as a normal user and try a refused-permission message.',
      notes: 'Be especially careful with guest abilities. Presets don’t randomly change media/theme powers unrelated to the assistant.',
    },
    fineTune: {
      what: 'On top of a preset, turn individual abilities on or off one by one.',
      chain:
        '1) Change a single item → save.\n2) Matching abilities are checked under the new rules right away.\n3) Common case: the button still shows, but one click says no permission.\n4) Highest admin powers cannot be handed out to others here.',
      frontend: 'Whether each ability truly works. Use “clicked and got no permission” as a checklist.',
      notes: 'If it still looks like a preset after changes, check whether it’s already become a custom mix.',
    },
    userElevated: {
      what: 'Extra things ordinary signed-in users may do.',
      chain:
        '1) After a user signs in, the checks here apply.\n2) Part of the same set as the presets above.\n3) Admins are usually not limited by these.',
      frontend: 'Boundaries of signed-in users’ assistant / small-app abilities.',
      notes: 'Think through abuse risk before giving users “outbound network” and similar powers.',
    },
    guestElevated: {
      what: 'Extra things people who aren’t signed in may do (higher risk).',
      chain:
        '1) Unauthenticated visits are judged by this.\n2) Too open invites flooding of interfaces and AI.\n3) Guests usually don’t get a full backend assistant session.',
      frontend: 'Features guests can still see or click. Verify while signed out in a private window.',
      notes: 'In production, open as little as possible; also keep guest quota low.',
    },
    aiQuota: {
      what: 'How many times users and guests may each use smart features.',
      chain:
        '1) Over the limit → blocked even if models are fully configured.\n2) With permissions and model setup, three gates: all must pass to succeed.\n3) Going over does not auto-switch to a pricier model.',
      frontend: 'Over-quota error messages. Use a normal account near the limit to observe.',
      notes: 'Guest quota should be clearly lower than signed-in users.',
    },
    userQuota: {
      what: 'Usage cap for signed-in users.',
      chain:
        '1) Only constrains signed-in users.\n2) When full, related smart features show failure messages.\n3) When the count resets is decided by server policy.',
      frontend: 'Messages when that role has used up its quota.',
      notes: '0 or extremely low is effectively almost disabled (depending on implementation).',
    },
    guestQuota: {
      what: 'Usage cap for guests.',
      chain:
        '1) First gate against unsigned visitors flooding the site.\n2) Works together with guest permissions.\n3) When full, guest smart features are unavailable.',
      frontend: 'Messages related to the guest trial budget.',
      notes: 'Keep it fairly low.',
    },
  },

  users: {
    section: {
      what: 'Manage who can sign in to this site and who is an admin.',
      chain:
        '1) Create or adjust accounts here.\n2) They sign in with username/password (or linked third-party accounts).\n3) Admins can open system configuration; ordinary users still follow module visibility, permissions, and quotas.\n4) Deleting an account mainly affects login — it usually does not wipe display data synced from platforms.',
      frontend: 'Who can sign in, and whether admin menus are available. Logging in with a new account is the clearest check.',
      notes: 'Only admins can open this page; create few admins.',
    },
    create: {
      what: 'Create a new local account; optionally mark as admin.',
      chain:
        '1) Fill username and password → create.\n2) Usually can sign in right away.\n3) Checking admin grants configuration powers — use carefully.',
      frontend: 'New users see different entries after login. Sign in with the new account immediately to check.',
      notes: 'Use a strong enough password; double-check before ticking admin.',
    },
    list: {
      what: 'View, search, and manage existing users.',
      chain:
        '1) Search/filter to find people.\n2) Changing roles or handling accounts affects their powers on next login.\n3) Dangerous actions (delete, and so on) are hard to undo.',
      frontend: 'Who can sign in and who is an admin. After changes, have them sign in again to verify.',
      notes: 'Don’t accidentally delete the only admin account.',
    },
  },

  advanced: {
    network: {
      what: 'Whether the server uses a proxy when going to the open internet, and access addresses for a few services.',
      chain:
        '1) These are mainly for “the server itself going online”: syncing foreign platforms, calling smart services, and so on.\n2) Your browser opening this site, or jumping to third-party login, usually does not use this proxy.\n3) Domestic platforms may get slower if forced through a proxy — fill a “don’t use proxy for these” list.\n4) Problems often look like: sync fails, AI unavailable — not a broken page theme.',
      frontend: 'Page look usually unchanged. When something’s wrong, check data sync and whether the assistant errors.',
      notes: 'Don’t change login jump addresses to mirrors; that is not the same as “GitHub data sync address.”',
    },
    proxyEnable: {
      what: 'Whether the server uses a proxy when going out to the internet.',
      chain:
        '1) On → uses the proxy address below for outbound traffic.\n2) Off → direct connection (the address can stay saved unused).\n3) Affects whether platform auto-refresh, AI outbound calls, and similar succeed.',
      frontend: 'Indirect: sync/AI success rate. After enabling the proxy, try syncing a foreign platform once.',
      notes: 'The proxy itself must already work in your network environment.',
    },
    proxyUrl: {
      what: 'Address of the proxy server.',
      chain:
        '1) Only used when the switch above is on.\n2) Wrong fill = the server can’t reach the open internet.\n3) Often provided by a local or company proxy app.',
      frontend: 'No direct interface change. When it fails, sync/AI fail.',
      notes: 'Fill as the proxy app instructs; watch the port number.',
    },
    proxyBypass: {
      what: 'Which addresses should not use the proxy.',
      chain:
        '1) Hosts on the list are reached by the server directly.\n2) Often used for domestic services to avoid a long detour.\n3) Works with the master proxy switch: with the switch off, the list barely matters.',
      frontend: 'None. Smoother domestic platform sync may be thanks to this.',
      notes: 'Separate multiple entries with commas; can include local addresses.',
    },
    geminiBaseUrl: {
      what: 'Access address for one kind of smart service (most people can leave empty).',
      chain:
        '1) Only used when you actually use that service.\n2) Empty = official address.\n3) Random fill can take related AI fully offline.',
      frontend: 'Whether related smart calls succeed.',
      notes: 'Leave empty if you don’t understand it.',
    },
    githubApiBaseUrl: {
      what: 'Address used when pulling GitHub data (a mirror is allowed).',
      chain:
        '1) Affects whether GitHub platform sync goes smoothly.\n2) When signing in with a GitHub account, the authorize page is still official — this field can’t change that.\n3) Separate from “site address” and login return addresses — three different lines.',
      frontend: 'Whether GitHub-related material syncs successfully.',
      notes: 'Don’t confuse this with login return addresses.',
    },
    backup: {
      what: 'Back up current settings to a file, restore from a file, or reset to factory defaults.',
      chain:
        '1) Export: produces a settings file for you to download.\n2) Import: after review, writes back — many site settings change together.\n3) Reset: everything returns to defaults, hard to undo.\n4) Strongly recommended: export one copy first, then import or reset.',
      frontend: 'After import/reset, theme, modules, platforms, and more may change a lot. Spot-check the whole site afterward.',
      notes: 'Backup files may contain secret keys — don’t forward them freely.',
    },
    exportConfig: {
      what: 'Download a backup of the current settings.',
      chain:
        '1) Click export → get a file.\n2) Does not change the running site.\n3) For moving, backup, or a safety copy before something goes wrong.',
      frontend: 'No immediate change — only an extra file.',
      notes: 'Store it carefully; it contains sensitive information.',
    },
    importConfig: {
      what: 'Restore settings from a backup file.',
      chain:
        '1) Pick a file → confirm the preview → write back.\n2) The interface loads under the new settings.\n3) May overwrite your current theme, platforms, AI, and more.',
      frontend: 'Many options may change together. After import, spot-check login, library, and assistant.',
      notes: 'Wrong files fail; export the current state first if you can.',
    },
    resetConfig: {
      what: 'Restore everything to defaults.',
      chain:
        '1) Runs after a second confirmation.\n2) Personalized configuration is cleared back to the initial state.\n3) Almost impossible to undo lightly — always back up first.',
      frontend: 'Look and features feel like a fresh install.',
      notes: 'Extremely careful in production; export first.',
    },
  },

  federation: {
    keys: {
      what: 'This site’s identity and keys when connecting with other sites.',
      chain:
        '1) Used to prove “this post really came from this site,” and to recognize others.\n2) The identity address is bound to the site domain — an unstable domain causes trouble.\n3) After rotating keys, others may fail verification for a short time.',
      frontend: 'Whether following other sites and sending/receiving posts goes smoothly.',
      notes: 'Think carefully before rotating keys; don’t casually click rotate day to day.',
    },
    policy: {
      what: 'What kind of content from outside sites you’re willing to accept.',
      chain:
        '1) After rules are saved, inbound content is filtered by trust and lists first.\n2) Only what passes may appear in the feed.\n3) To be alerted, you also need the matching source open under “Notifications.”\n4) Too strict → you miss friends’ sites; too loose → spam arrives easily.',
      frontend: 'Whether you can see posts from other sites. Mutual follow with a friend site is a good test.',
      notes: 'Raise trust for familiar sites first, then slowly tighten overall policy.',
    },
    minTrust: {
      what: 'How trusted inbound content must be before you’ll accept it.',
      chain:
        '1) Content from sites below this level is dropped.\n2) Raise friends’ trust under “Known instances.”\n3) Together with allowlist and content filters, this is the inbound threshold.',
      frontend: 'Content from low-trust sites does not appear.',
      notes: 'Add friends first, then raise the bar.',
    },
    allowlist: {
      what: 'Only allow sites on the list to interconnect (if you enable that policy).',
      chain:
        '1) Sites not on the list basically don’t interact.\n2) Can work with auto-discover: discover first, then decide whether to add to the list.\n3) Behavior when the list is empty follows the on-page description.',
      frontend: 'No interaction with sites outside the list.',
      notes: 'When typing domains, avoid extra spaces and typos.',
    },
    autoDiscover: {
      what: 'Whether to automatically remember new sites when you encounter them.',
      chain:
        '1) Once remembered they appear in the “Known instances” list.\n2) Makes it easier later to adjust trust or block.\n3) Still subject to allowlist and minimum trust — not open to everyone.',
      frontend: 'Known instances list grows longer.',
      notes: 'Fine to leave on for public sites; turn off for very private deployments.',
    },
    knownInstances: {
      what: 'Sites already seen: adjust trust, block, search.',
      chain:
        '1) Blocking here rejects that site immediately.\n2) Changing trust affects whether you accept its content later.\n3) Links with the minimum trust in policy.',
      frontend: 'Whether that site’s content / related notifications appear. After blocking, you should stop receiving them at once.',
      notes: 'Blocking affects both ways — confirm the site name before acting.',
    },
    contentFilters: {
      what: 'Another pass of filters on inbound content by type, keywords, and so on.',
      chain:
        '1) Rules take effect immediately.\n2) Content matching rules never enters the feed or notifications.\n3) Another sieve after trust/lists.\n4) Rules written too broadly also block normal content.',
      frontend: 'You don’t see filtered content. Add a test rule first, then remove it.',
      notes: 'Try a small range first; watch for a few days before tightening.',
    },
    deliveryQueue: {
      what: 'Health of the send queue for posts this site delivers to others.',
      chain:
        '1) Content you send is queued for delivery to the other side.\n2) Failures retry or enter a “couldn’t deliver” list.\n3) If the other side never receives you: check the queue + network/proxy + whether they blocked you.\n4) Clearing the queue throws away what’s still unsent.',
      frontend: 'Queue status; whether the other site sees your posts in time.',
      notes: 'Different direction from “limit what others send in” — don’t only tune one side.',
    },
    advanced: {
      what: 'Limits that prevent too many requests in a short time.',
      chain:
        '1) Over the limit temporarily rejects the other side.\n2) More trusted sites can get a higher multiplier.\n3) Defaults are usually enough; tune only when you’re being flooded.',
      frontend: 'The other side may fail to sync; you may see it in ops information.',
      notes: 'Don’t set extremely small values “for safety” without reason — you’ll hurt friend sites.',
    },
    rateMax: {
      what: 'Maximum requests accepted in a period of time.',
      chain:
        '1) Together with the “time window” below, decides how tight the limit is.\n2) Over limit → reject the other side for a while.\n3) Trusted sites can also be multiplied higher.',
      frontend: 'When over limit, the other side can’t connect.',
      notes: 'Too small hurts normal traffic.',
    },
    rateWindow: {
      what: 'How long a period the count above is measured over.',
      chain:
        '1) When the window ends, the count restarts.\n2) Short window + small max = easier to hit the limit.',
      frontend: 'Works together with the request max.',
      notes: 'Fill within the range the page shows.',
    },
    rateTrusted: {
      what: 'How many times higher the limit is for more trusted sites.',
      chain:
        '1) Friend sites are less likely to be blocked.\n2) Very large multiplier is almost unlimited.\n3) Depends on trust levels you set under known instances.',
      frontend: 'Friendlier sites feel smoother.',
      notes: 'Only give high multipliers to sites you truly trust.',
    },
  },

  updater: {
    channel: {
      what: 'Which release line upgrades follow: stable, preview, or development.',
      chain:
        '1) After you pick one, the channel is remembered.\n2) “Check for updates” looks for new versions on that line.\n3) You confirm the upgrade → may enter maintenance → backup → switch version → open again.\n4) The visitor home page does not change just because you “picked a channel” — only after the upgrade finishes.',
      frontend: 'Version and notes shown in About / updater areas of settings.',
      notes: 'For real use, prefer the stable (official) channel; preview/dev can be unstable.',
    },
    maintenance: {
      what: 'How to recover when an upgrade problem leaves the site in maintenance.',
      chain:
        '1) A failed upgrade stops on the maintenance page.\n2) Prefer “restore from the pre-upgrade backup.”\n3) “Force exit maintenance” only closes the maintenance page — data may still be half-updated.\n4) After rescue, check whether the site is healthy again.',
      frontend: 'Maintenance notice page versus the normal site.',
      notes: 'If rescue is available, rescue first — don’t force-exit first.',
    },
    rescue: {
      what: 'Use the pre-upgrade backup to restore data and state.',
      chain:
        '1) Choose rescue → restore backup → services come up → leave maintenance.\n2) The site returns to the moment of that backup.\n3) Relatively the safest path.',
      frontend: 'After maintenance ends, site content/settings match the backup point.',
      notes: 'Before rescuing, confirm this is the point in time you want to return to.',
    },
    forceExit: {
      what: 'Leave maintenance without restoring a backup.',
      chain:
        '1) Maintenance page closes.\n2) Half-updated data is not auto-fixed.\n3) You may open the site but with broken features.',
      frontend: 'Site opens, but content may look wrong.',
      notes: 'Only when you accept the current state; otherwise rescue first.',
    },
    infra: {
      what: 'Versions of helper components that perform upgrades.',
      chain:
        '1) Separate line from “main website program upgrade.”\n2) Upgrading them may also briefly enter maintenance.\n3) When a new version is available, this area prompts you.',
      frontend: 'Ops hints; ordinary visitors usually don’t notice.',
      notes: 'Sometimes these components need updating before the main site update.',
    },
    target: {
      what: 'Install a particular old or specified version (advanced).',
      chain:
        '1) Similar to a normal upgrade, but you choose the version.\n2) Features may shrink or behave differently.\n3) Wrong choice may leave the site unable to start.',
      frontend: 'Site-wide features may roll back.',
      notes: 'Not for daily use; if something breaks, use rescue rather than picking random versions.',
    },
    snapshot: {
      what: 'List of automatic backups taken before upgrades.',
      chain:
        '1) Auto backup before upgrade.\n2) On problems you can roll back or rescue from here.\n3) How many you can keep depends on disk space.',
      frontend: 'After rollback, content and settings return to the backup point.',
      notes: 'Before important upgrades, confirm a fresh snapshot exists.',
    },
    advanced: {
      what: 'How often to check for updates, whether to auto-install, and similar.',
      chain:
        '1) Scheduled checks will hint when a new version exists.\n2) If auto-install is on, upgrade and maintenance may start while you’re not watching.\n3) Some connection methods need an extra passphrase — fill as instructed.',
      frontend: 'Background checks; with auto-install, maintenance may appear suddenly.',
      notes: 'Be careful with auto-install in production.',
    },
  },

  about: {
    section: {
      what: 'View current version and project info; some environments also embed an update entry.',
      chain:
        '1) Mainly read-only information here.\n2) If an updater panel is embedded, the upgrade flow is the same as under “Updater” settings.\n3) When reporting errors, sending the version number to maintainers is very useful.',
      frontend: 'About page text and version number.',
      notes: 'Usually does not change your business settings.',
    },
  },
}
