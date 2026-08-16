const MOBILE_STYLE = `
@media (max-width: 720px), (max-height: 500px) and (pointer: coarse) {
  html,
  body,
  #root {
    height: 100dvh;
  }

  /* The collapsed rail becomes a top toolbar, leaving the conversation its
     full width; an explicitly opened sidebar still takes the whole frame. */
  body [data-details-collapsed][data-sidebar-collapsed] {
    grid-template-columns: minmax(0, 1fr) 0 0 !important;
    grid-template-rows: 56px minmax(0, 1fr);
  }

  body [data-details-collapsed][data-sidebar-collapsed] > .pI_x6G_sidebarCol {
    grid-row: 1;
    grid-column: 1;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }

  body [data-details-collapsed][data-sidebar-collapsed] > .pI_x6G_centerCol {
    grid-row: 2;
    grid-column: 1;
  }

  body [data-details-collapsed][data-sidebar-collapsed] > .pI_x6G_detailsCol {
    grid-row: 1 / span 2;
    grid-column: 2;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_root.hHd-Xa_collapsed {
    box-sizing: border-box;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 56px;
    padding: 8px;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_logoRow,
  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_newSession {
    width: 40px;
    height: 40px;
    margin: 0;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_logoRow {
    padding: 0;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_iconButton,
  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_newSession,
  body [data-details-collapsed][data-sidebar-collapsed] .VOzbGW_trigger.VOzbGW_rail {
    width: 40px;
    height: 40px;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_regionArea {
    flex-direction: row;
    margin: 0;
    padding: 0;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .qDHVXG_root.qDHVXG_rail {
    flex-direction: row;
    align-items: center;
    height: 40px;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .qDHVXG_rail .qDHVXG_sectionHeader,
  body [data-details-collapsed][data-sidebar-collapsed] .qDHVXG_rail .qDHVXG_search,
  body [data-details-collapsed][data-sidebar-collapsed] .VOzbGW_trigger.VOzbGW_rail {
    margin: 0;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .qDHVXG_rail .qDHVXG_listArea {
    display: none;
  }

  body [data-details-collapsed][data-sidebar-collapsed] .hHd-Xa_footArea {
    flex-direction: row;
    margin-left: auto;
  }

  body [data-details-collapsed]:not([data-sidebar-collapsed]) {
    grid-template-columns: 100% 0 0 !important;
  }

  body [data-details-collapsed]:not([data-sidebar-collapsed]) [data-slot='sidebar'] > * {
    width: 100% !important;
  }

  body [data-details-collapsed] > [data-side] {
    display: none;
  }

  body [data-phase] {
    --dsh-composer-side-clearance: 8px;
  }

  body .Md3f7G_scroll {
    padding: 12px;
  }

  body .gdEzaW_userStack {
    max-width: 90%;
  }

  body .wSkVaW_header {
    padding: 8px 12px 0;
  }

  body .wSkVaW_headerUtilities {
    gap: 4px;
    margin-left: 8px;
  }

  body .wSkVaW_tabs {
    gap: 20px;
    overflow-x: auto;
  }

  body .uV2eYG_row {
    gap: 4px;
    padding-inline: 6px;
  }

  body .uV2eYG_tools {
    gap: 6px;
  }

  body .uV2eYG_modes,
  body .uV2eYG_trailing {
    gap: 4px;
  }

  body .uV2eYG_select {
    max-width: 100px;
  }

  body .pXSMma_headline {
    grid-template-columns: 28px auto auto;
    column-gap: 6px;
    font-size: 22px;
    line-height: 28px;
  }

  /* Settings is the only dialog with a direct nav child. On phones it becomes
     a full-height column with a horizontally scrollable section strip. */
  body [role='dialog'][aria-modal='true']:has(> nav) {
    box-sizing: border-box;
    flex-direction: column;
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav {
    box-sizing: border-box;
    width: 100%;
    gap: 8px;
    padding: calc(12px + env(safe-area-inset-top)) 12px 8px;
    border-bottom: 1px solid var(--dsw-alias-border-l2);
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav > :first-child {
    padding-inline: 8px;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav > :last-child {
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav > :last-child::-webkit-scrollbar {
    display: none;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav button {
    flex: none;
    height: 40px;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav + div {
    min-height: 0;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav + div > :first-child {
    height: 44px;
    padding: 8px 12px 4px;
  }

  body [role='dialog'][aria-modal='true']:has(> nav) > nav + div > :last-child {
    padding: 0 16px calc(16px + env(safe-area-inset-bottom));
  }

  body [role='dialog'][aria-modal='true'] :is(input, select, textarea) {
    font-size: 16px;
  }

  body .oY77xG_row,
  body .T1PP_q_row {
    align-items: stretch;
    flex-direction: column;
  }

  body .oY77xG_rowText,
  body .T1PP_q_rowText {
    padding-right: 0;
  }

  body .oY77xG_selector,
  body .T1PP_q_selector {
    align-self: flex-start;
  }

  body .dsh-lan-auth__form {
    flex-wrap: wrap;
  }

  body .zGbnIq_rowHead {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  body .zGbnIq_modelRow {
    grid-template-columns: minmax(0, 1fr) 28px 28px;
  }

  body .zGbnIq_modelRow > :first-child {
    grid-column: 1 / -1;
  }

  body .zGbnIq_editor,
  body .zGbnIq_addCard,
  body .zGbnIq_setupCard {
    padding: 12px;
  }
}
`

const MOBILE_BEHAVIOR = `document.addEventListener("click",event=>{if(!matchMedia("(max-width: 720px), (max-height: 500px) and (pointer: coarse)").matches)return;const target=event.target;if(!(target instanceof Element))return;const row=target.closest("[data-slot='sidebar.workspaces'] [role='treeitem'][aria-selected]");if(row===null)return;const button=target.closest("button");if(button!==null&&button!==row)return;const frame=document.querySelector("[data-details-collapsed]:not([data-sidebar-collapsed])");if(frame===null)return;requestAnimationFrame(()=>frame.querySelector("[data-slot='sidebar'] .hHd-Xa_toggle")?.click())})`

export const name = 'web-mobile-style'
export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.tapIndex(html => html.replace('</head>', `<style data-web-mobile-style>${MOBILE_STYLE}</style><script data-web-mobile-behavior>${MOBILE_BEHAVIOR}</script></head>`)),
    'mobile web styles and behavior',
  )
}
