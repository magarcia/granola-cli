import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { formatOutput, type OutputFormat, table } from '../../lib/output.js';
import { list as listFolders } from '../../services/folders.js';
import type { Folder } from '../../types.js';

const debug = createGranolaDebug('cmd:folder:list');

/**
 * Creates the 'list' command for displaying folders.
 *
 * Lists folders with optional filtering by workspace.
 * Supports -o/--output for structured output.
 *
 * @returns Commander command instance
 */
export function createListCommand() {
  return new Command('list')
    .description('List folders')
    .option('-w, --workspace <id>', 'Filter by workspace')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (opts) => {
      debug('folder list command invoked with opts: %O', opts);

      let data: Folder[];
      try {
        data = await listFolders({
          workspace: opts.workspace,
        });
        debug('fetched %d folders', data.length);
      } catch (error) {
        console.error(chalk.red('Error:'), 'Failed to list folders.');
        if (error instanceof Error) {
          console.error(chalk.dim(error.message));
        }
        process.exit(1);
      }

      // Handle structured output formats
      const format = opts.output || null;
      if (format) {
        if (!['json', 'yaml', 'toon'].includes(format)) {
          console.error(chalk.red(`Invalid format: ${format}. Use 'json', 'yaml', or 'toon'.`));
          process.exit(1);
        }
        console.log(formatOutput(data, format as OutputFormat));
        return;
      }

      if (data.length === 0) {
        console.log(chalk.dim('No folders found.'));
        return;
      }

      const rows = data.map((folder) => ({
        ...folder,
        display_name: folder.name || folder.title || 'Unnamed',
      }));

      const output = table(rows, [
        { key: 'id', header: 'ID', width: 12, format: (v) => String(v).slice(0, 8) },
        { key: 'display_name', header: 'NAME', width: 20, format: (v) => String(v || '') },
        {
          key: 'workspace_name',
          header: 'WORKSPACE',
          width: 20,
          format: (v) => String(v || ''),
        },
      ]);

      console.log(output);
    });
}

export const listCommand = createListCommand();
