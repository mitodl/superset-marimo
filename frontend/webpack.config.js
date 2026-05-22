// Licensed under BSD-3-Clause. See LICENSE in the project root.
const path = require('path');
const { ModuleFederationPlugin } = require('webpack').container;
const packageConfig = require('./package.json');
const extensionConfig = require('../extension.json');

// Kebab-to-camelCase: "marimo-notebooks" → "marimoNotebooks"
function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Module Federation container name: "mitodl_marimoNotebooks"
const mfName = `${extensionConfig.publisher}_${toCamelCase(extensionConfig.name)}`;

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: isProd ? {} : './src/index.tsx',
    mode: isProd ? 'production' : 'development',

    devServer: {
      port: 3001,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },

    output: {
      clean: true,
      filename: isProd ? undefined : '[name].[contenthash].js',
      chunkFilename: '[name].[contenthash].js',
      path: path.resolve(__dirname, 'dist'),
      // Assets are served by Superset under the extension's API namespace.
      publicPath: `/api/v1/extensions/${extensionConfig.publisher}/${extensionConfig.name}/`,
    },

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },

    // Map @apache-superset/core to window.superset at runtime so the
    // extension uses the host's copy rather than bundling its own.
    externalsType: 'window',
    externals: {
      '@apache-superset/core': 'superset',
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },

    plugins: [
      new ModuleFederationPlugin({
        name: mfName,
        // Convention: Superset always loads './index' from the remote.
        filename: 'remoteEntry.[contenthash].js',
        exposes: {
          './index': './src/index.tsx',
        },
        shared: {
          react: {
            singleton: true,
            requiredVersion: packageConfig.peerDependencies.react,
            import: false, // use host's React
          },
          'react-dom': {
            singleton: true,
            requiredVersion: packageConfig.peerDependencies['react-dom'],
            import: false,
          },
          antd: {
            singleton: true,
            requiredVersion: packageConfig.peerDependencies.antd,
            import: false,
          },
        },
      }),
    ],
  };
};
