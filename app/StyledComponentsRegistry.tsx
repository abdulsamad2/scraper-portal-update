'use client';

import React, { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { ServerStyleSheet, StyleSheetManager } from 'styled-components';

// Props that should not be forwarded to DOM elements
const shouldForwardProp = (prop: string) => {
  // Filter out react-data-table-component specific props
  const filteredProps = [
    'allowOverflow',
    'button',
    'ignoreRowClick',
    'sortable',
    'selector',
    'cell',
    'width',
    'right',
    'center',
    'compact',
    'grow',
    'wrap',
    'hide',
    'omit',
    'conditionalCellStyles',
    'format'
  ];
  
  // Don't forward filtered props to DOM
  if (filteredProps.includes(prop)) {
    return false;
  }
  
  // Don't forward props that start with uppercase (React component props)
  if (prop[0] === prop[0].toUpperCase()) {
    return false;
  }
  
  // Allow all other props
  return true;
};

export default function StyledComponentsRegistry({
  children,
}: {
  children: React.ReactNode;
}) {
  // Only run on server-side
  const [styledComponentsStyleSheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = styledComponentsStyleSheet.getStyleElement();
    styledComponentsStyleSheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== 'undefined') {
    return (
      <StyleSheetManager shouldForwardProp={(prop) => shouldForwardProp(prop)}>
        {children}
      </StyleSheetManager>
    );
  }

  return (
    <StyleSheetManager
      sheet={styledComponentsStyleSheet.instance}
      shouldForwardProp={(prop) => shouldForwardProp(prop)}
    >
      {children}
    </StyleSheetManager>
  );
}