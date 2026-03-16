import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetShipiboWords, useGetShipiboCategories, useCreateShipiboWord } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, Plus, Filter, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const wordSchema = z.object({
  word: z.string().min(1, "Word is required"),
  translation: z.string().min(1, "Translation is required"),
  partOfSpeech: z.string(),
  categoryId: z.string(),
});

export default function ShipiboApp() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: wordPage, isLoading } = useGetShipiboWords({ q: debouncedSearch, limit: 50 });
  const { data: categories } = useGetShipiboCategories();

  const form = useForm<z.infer<typeof wordSchema>>({
    resolver: zodResolver(wordSchema),
    defaultValues: { word: "", translation: "", partOfSpeech: "noun", categoryId: "" }
  });

  const { mutate: createWord, isPending } = useCreateShipiboWord({
    mutation: {
      onSuccess: () => {
        toast({ title: "Word added successfully" });
        setIsDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: ["/api/shipibo/words"] });
      }
    }
  });

  return (
    <AppLayout>
      <div className="p-8 max-w-7xl mx-auto w-full flex flex-col h-full">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Shipibo Dictionary</h1>
              <p className="text-muted-foreground mt-2">Manage and search indigenous vocabulary</p>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" /> Add Entry</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Word</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((v) => createWord({ data: v }))} className="space-y-4 pt-4">
                    <FormField control={form.control} name="word" render={({ field }) => (
                      <FormItem><FormLabel>Shipibo Word</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="translation" render={({ field }) => (
                      <FormItem><FormLabel>Translation</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="partOfSpeech" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Part of Speech</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="noun">Noun</SelectItem>
                              <SelectItem value="verb">Verb</SelectItem>
                              <SelectItem value="adjective">Adjective</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="categoryId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {categories?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                    <Button type="submit" className="w-full mt-6" disabled={isPending}>Save Entry</Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="flex-1 flex flex-col overflow-hidden shadow-md border-border/50">
            <div className="p-4 border-b flex gap-4 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Search Shipibo words, translations..." 
                  className="pl-9 h-10 bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" className="h-10"><Filter className="w-4 h-4 mr-2" /> Filter</Button>
            </div>
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead>Word</TableHead>
                    <TableHead>Translation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={5} className="h-16 animate-pulse bg-muted/20" /></TableRow>
                    ))
                  ) : wordPage?.words?.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-32 text-muted-foreground">No words found</TableCell></TableRow>
                  ) : (
                    wordPage?.words.map(word => (
                      <TableRow key={word.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-medium text-lg text-primary flex items-center gap-2">
                          {word.word}
                          {word.pronunciation && <Volume2 className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-primary" />}
                        </TableCell>
                        <TableCell>{word.translation}</TableCell>
                        <TableCell><span className="text-muted-foreground capitalize">{word.partOfSpeech}</span></TableCell>
                        <TableCell><Badge variant="outline">{word.categoryName || 'Uncategorized'}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={word.status === 'published' ? 'default' : 'secondary'} className="capitalize">
                            {word.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </motion.div>
      </div>
    </AppLayout>
  );
}
