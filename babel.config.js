import { readFileSync } from 'fs';
import path from 'path';

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, './package.json')),
);

export default function (api) {
  const plugins = [
    ['@babel/plugin-transform-react-jsx', {
      runtime: 'automatic',
      importSource: 'preact',
    }],
  ];

  const presets = [
    [
      '@babel/preset-env',
      api.caller((caller) => caller && caller.target === 'node')
        ? {
            targets: {
              node: pkg.engines.node.replace(/^\D+/g, ''),
            },
            modules: false,
          }
        : {
            targets: {
              browsers: pkg.browserslist,
            },
          },
    ],
  ];

  return {
    presets,
    plugins,
  };
}
