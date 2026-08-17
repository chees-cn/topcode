import { Module } from '@nestjs/common';
import { FileSystemTool } from './file-system.tool';
import { TerminalTool } from './terminal.tool';

@Module({
  providers: [FileSystemTool, TerminalTool],
  exports: [FileSystemTool, TerminalTool],
})
export class ToolsModule {}
