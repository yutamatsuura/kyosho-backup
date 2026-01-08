import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 複雑度チェック
      'complexity': ['error', { max: 10 }],
      // 関数の最大行数
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      // ファイルの最大行数
      'max-lines': ['warn', { max: 700, skipBlankLines: true, skipComments: true }],
      // 行の最大長
      'max-len': ['warn', { code: 120, ignoreUrls: true, ignoreStrings: true }],
    },
  }
);